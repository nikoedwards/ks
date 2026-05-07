import { createHash, randomBytes } from 'crypto';
import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'kickstarter.db');

function getDB() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return new BetterSqlite3(DB_PATH);
}

export interface AuthUser { id: number; username: string; email: string | null; }

const SESSION_DAYS = 30;

function hashPassword(pw: string): string {
  return createHash('sha256').update('ks:' + pw).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

export function createUser(username: string, password: string, email?: string): AuthUser {
  const db = getDB();
  const hash = hashPassword(password);
  const result = db.prepare(
    `INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)`
  ).run(username.trim(), email?.trim() ?? null, hash);
  return { id: Number(result.lastInsertRowid), username: username.trim(), email: email?.trim() ?? null };
}

export function verifyUser(username: string, password: string): AuthUser | null {
  const db = getDB();
  const user = db.prepare(`SELECT id, username, email, password_hash FROM users WHERE username = ?`).get(username.trim()) as
    ({ id: number; username: string; email: string | null; password_hash: string }) | undefined;
  if (!user) return null;
  if (user.password_hash !== hashPassword(password)) return null;
  return { id: user.id, username: user.username, email: user.email };
}

export function createSession(userId: number): string {
  const db = getDB();
  const token = generateToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  db.prepare(`INSERT OR REPLACE INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, userId, expiresAt);
  return token;
}

export function getSessionUser(token: string): AuthUser | null {
  if (!token) return null;
  const db = getDB();
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare(
    `SELECT u.id, u.username, u.email FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, now) as AuthUser | undefined;
  return row ?? null;
}

export function deleteSession(token: string): void {
  getDB().prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function usernameExists(username: string): boolean {
  const row = getDB().prepare(`SELECT 1 FROM users WHERE username = ?`).get(username.trim());
  return !!row;
}

// ── Favorites ────────────────────────────────────────────────────────────────

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

export const SESSION_COOKIE = 'ks_session';
