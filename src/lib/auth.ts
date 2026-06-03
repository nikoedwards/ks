import { createHash, randomBytes } from 'crypto';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'kickstarter.db');

function getDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new BetterSqlite3(DB_PATH);
  ensureAuthMigrations(db);
  return db;
}

export type UserRole = 'admin' | 'user';
export interface AuthUser { id: number; username: string; email: string | null; role: UserRole; }

const SESSION_DAYS = 30;

function hashPassword(pw: string): string {
  return createHash('sha256').update('ks:' + pw).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function ensureAuthMigrations(db: BetterSqlite3.Database) {
  try { db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 1'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN last_login_at INTEGER'); } catch { /* already exists */ }
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_registrations (
      email TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (adminEmail) {
    db.prepare("UPDATE users SET role = 'admin' WHERE lower(email) = ?").run(adminEmail);
  }
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)").run();
  }
}

// ── User creation ──────────────────────────────────────────────────────────────

export function createUser(username: string, password: string, email?: string): AuthUser {
  const db = getDB();
  const hash = hashPassword(password);
  const result = db.prepare(
    `INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, 1)`
  ).run(username.trim(), email?.trim()?.toLowerCase() ?? null, hash);
  return { id: Number(result.lastInsertRowid), username: username.trim(), email: email?.trim() ?? null, role: 'user' };
}

export function createUserByEmail(email: string, password: string): AuthUser {
  const db = getDB();
  const hash = hashPassword(password);
  const username = uniqueUsername(db, usernameFromEmail(email));
  const result = db.prepare(
    `INSERT INTO users (username, email, password_hash, email_verified) VALUES (?, ?, ?, 0)`
  ).run(username, email.trim().toLowerCase(), hash);
  return { id: Number(result.lastInsertRowid), username, email: email.trim().toLowerCase(), role: 'user' };
}

export function activateUser(email: string) {
  getDB().prepare(`UPDATE users SET email_verified = 1 WHERE email = ?`).run(email.trim().toLowerCase());
}

function usernameFromEmail(email: string): string {
  return email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 32) || 'user';
}

function uniqueUsername(db: BetterSqlite3.Database, base: string): string {
  let username = base;
  let suffix = 1;
  while (db.prepare(`SELECT 1 FROM users WHERE username = ?`).get(username)) {
    suffix += 1;
    username = `${base}${suffix}`;
  }
  return username;
}

// ── Lookup helpers ─────────────────────────────────────────────────────────────

export function verifyUser(username: string, password: string): AuthUser | null {
  const db = getDB();
  const user = db.prepare(`SELECT id, username, email, role, password_hash, email_verified FROM users WHERE username = ?`).get(username.trim()) as
    ({ id: number; username: string; email: string | null; role: UserRole; password_hash: string; email_verified: number }) | undefined;
  if (!user) return null;
  if (user.password_hash !== hashPassword(password)) return null;
  if (user.email_verified !== 1) return null;
  return { id: user.id, username: user.username, email: user.email, role: user.role ?? 'user' };
}

export function verifyUserByEmail(email: string, password: string): AuthUser | null {
  const db = getDB();
  const user = db.prepare(`SELECT id, username, email, role, password_hash, email_verified FROM users WHERE email = ?`).get(email.trim().toLowerCase()) as
    ({ id: number; username: string; email: string | null; role: UserRole; password_hash: string; email_verified: number }) | undefined;
  if (!user) return null;
  if (user.password_hash !== hashPassword(password)) return null;
  if (user.email_verified !== 1) return null;
  return { id: user.id, username: user.username, email: user.email, role: user.role ?? 'user' };
}

export function usernameExists(username: string): boolean {
  return !!getDB().prepare(`SELECT 1 FROM users WHERE username = ?`).get(username.trim());
}

export function emailExists(email: string): boolean {
  return !!getDB().prepare(`SELECT 1 FROM users WHERE email = ?`).get(email.trim().toLowerCase());
}

// ── OTP ───────────────────────────────────────────────────────────────────────

export function createOtp(email: string): string {
  const db = getDB();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  db.prepare(`DELETE FROM email_otps WHERE email = ?`).run(email.toLowerCase());
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60; // 10 min
  db.prepare(`INSERT INTO email_otps (email, code, expires_at) VALUES (?, ?, ?)`).run(email.toLowerCase(), code, expiresAt);
  return code;
}

export function createPendingRegistration(email: string, password: string): string {
  const db = getDB();
  const normalizedEmail = email.trim().toLowerCase();
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const username = usernameFromEmail(normalizedEmail);
  const hash = hashPassword(password);
  db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(normalizedEmail);
  db.prepare(
    `INSERT INTO pending_registrations (email, username, password_hash, code, expires_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(normalizedEmail, username, hash, code, expiresAt);
  return code;
}

export function deletePendingRegistration(email: string): void {
  getDB().prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(email.trim().toLowerCase());
}

export function completePendingRegistration(email: string, code: string): AuthUser | null {
  const db = getDB();
  const normalizedEmail = email.trim().toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  const pending = db.prepare(
    `SELECT email, username, password_hash FROM pending_registrations
     WHERE email = ? AND code = ? AND expires_at > ?`
  ).get(normalizedEmail, code.trim(), now) as
    ({ email: string; username: string; password_hash: string }) | undefined;
  if (!pending) return null;
  if (emailExists(normalizedEmail)) {
    deletePendingRegistration(normalizedEmail);
    return null;
  }

  const createVerifiedUser = db.transaction(() => {
    const username = uniqueUsername(db, pending.username);
    const result = db.prepare(
      `INSERT INTO users (username, email, password_hash, email_verified)
       VALUES (?, ?, ?, 1)`
    ).run(username, normalizedEmail, pending.password_hash);
    db.prepare(`DELETE FROM pending_registrations WHERE email = ?`).run(normalizedEmail);
    db.prepare(`DELETE FROM email_otps WHERE email = ?`).run(normalizedEmail);
    return { id: Number(result.lastInsertRowid), username, email: normalizedEmail, role: 'user' as UserRole };
  });

  return createVerifiedUser();
}

export function verifyOtp(email: string, code: string): boolean {
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(`SELECT id FROM email_otps WHERE email = ? AND code = ? AND expires_at > ? AND used = 0`).get(email.toLowerCase(), code, now) as { id: number } | null;
  if (!row) return false;
  db.prepare(`UPDATE email_otps SET used = 1 WHERE id = ?`).run(row.id);
  activateUser(email);
  return true;
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export function createSession(userId: number): string {
  const db = getDB();
  const token = generateToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  db.prepare(`INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  // Record last login here so it covers both password login and OTP/verify flows
  // (both create a session through this function).
  try { db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(Math.floor(Date.now() / 1000), userId); } catch { /* column added by ensureAuthMigrations */ }
  return token;
}

export function getSessionUser(token: string): AuthUser | null {
  if (!token) return null;
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT u.id, u.username, u.email, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, now) as AuthUser | undefined;
  return row ?? null;
}

export function deleteSession(token: string): void {
  getDB().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

// ── Favorites ──────────────────────────────────────────────────────────────────

export function addFavorite(userId: number, projectId: string): void {
  getDB().prepare(`INSERT OR IGNORE INTO favorites (user_id, project_id) VALUES (?, ?)`).run(userId, projectId);
}

export function removeFavorite(userId: number, projectId: string): void {
  getDB().prepare(`DELETE FROM favorites WHERE user_id = ? AND project_id = ?`).run(userId, projectId);
}

export function getFavoriteIds(userId: number): string[] {
  const rows = getDB().prepare(`SELECT project_id FROM favorites WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as { project_id: string }[];
  return rows.map(r => r.project_id);
}

export function getUserByEmail(email: string): AuthUser | null {
  return getDB().prepare(`SELECT id, username, email, role FROM users WHERE email = ?`).get(email.toLowerCase()) as AuthUser | null;
}

export const SESSION_COOKIE = 'ks_session';
