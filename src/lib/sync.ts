import { parse } from 'csv-parse';
import unzipper from 'unzipper';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDBInstance, upsertBatch, insertSyncLog, updateSyncLog, saveDB } from './db';
import { updateSyncState } from './syncState';

const DATASETS_PAGE = 'https://webrobots.io/kickstarter-datasets/';

export async function getLatestDatasetUrl(): Promise<string> {
  const res = await fetch(DATASETS_PAGE, { cache: 'no-store' });
  const html = await res.text();
  const regex = /https:\/\/s3\.amazonaws\.com\/weruns\/forfun\/Kickstarter\/Kickstarter_[\w\-:.]+\.zip/g;
  const matches = [...new Set(html.match(regex) ?? [])];
  if (matches.length === 0) throw new Error('webrobots.io 页面上未找到数据集链接');
  matches.sort();
  // Return ONLY the latest dataset URL
  return matches[matches.length - 1];
}

interface RawRecord {
  id?: string;
  name?: string;
  blurb?: string;
  goal?: string;
  pledged?: string;
  state?: string;
  slug?: string;
  country?: string;
  country_displayable_name?: string;
  currency?: string;
  deadline?: string;
  created_at?: string;
  launched_at?: string;
  staff_pick?: string;
  backers_count?: string;
  usd_pledged?: string;
  static_usd_rate?: string;
  creator?: string;
  category?: string;
  source_url?: string;
}

function parseRecord(raw: RawRecord): Record<string, unknown> | null {
  if (!raw.id || !raw.name || !raw.state) return null;

  let category_id: number | null = null;
  let category_name: string | null = null;
  let category_parent: string | null = null;
  try {
    const cat = JSON.parse(raw.category || '{}');
    category_id = cat.id ?? null;
    category_name = cat.name ?? null;
    category_parent = cat.parent_name ?? cat.name ?? null;
  } catch { /* ignore */ }

  let creator_name: string | null = null;
  try {
    creator_name = JSON.parse(raw.creator || '{}').name ?? null;
  } catch { /* ignore */ }

  const goal = parseFloat(raw.goal || '0') || 0;
  const pledged = parseFloat(raw.pledged || '0') || 0;
  const usd_rate = parseFloat(raw.static_usd_rate || '1') || 1;
  const usd_pledged = parseFloat(raw.usd_pledged || String(pledged * usd_rate)) || 0;

  return {
    id: raw.id,
    name: raw.name.slice(0, 500),
    blurb: raw.blurb?.slice(0, 1000) ?? null,
    goal, pledged, usd_pledged,
    state: raw.state,
    country: raw.country ?? null,
    country_name: raw.country_displayable_name ?? null,
    currency: raw.currency ?? null,
    category_id, category_name, category_parent,
    backers_count: parseInt(raw.backers_count || '0') || 0,
    staff_pick: raw.staff_pick === 'True' || raw.staff_pick === 'true' ? 1 : 0,
    created_at: raw.created_at ? parseInt(raw.created_at) || null : null,
    launched_at: raw.launched_at ? parseInt(raw.launched_at) || null : null,
    deadline: raw.deadline ? parseInt(raw.deadline) || null : null,
    creator_name,
    source_url: raw.source_url ?? null,
    slug: raw.slug ?? null,
  };
}

// Step 1: Download ZIP to a temp file on disk — simple, reliable, shows progress
async function downloadZip(url: string, onProgress: (pct: number, downloaded: number, total: number) => void): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}: ${res.statusText}`);
  if (!res.body) throw new Error('响应体为空');

  const contentLength = parseInt(res.headers.get('content-length') || '0');
  const tmpPath = path.join(os.tmpdir(), `ks-${Date.now()}.zip`);
  const writer = fs.createWriteStream(tmpPath);

  let downloaded = 0;
  const reader = res.body.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(Buffer.from(value));
      downloaded += value.byteLength;
      if (contentLength > 0) {
        const pct = Math.floor((downloaded / contentLength) * 100);
        onProgress(pct, downloaded, contentLength);
      }
    }
  } finally {
    reader.releaseLock();
  }

  await new Promise<void>((resolve, reject) => {
    writer.end();
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return tmpPath;
}

function fmtMB(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function parseCsvEntry(
  entry: any,
  db: Awaited<ReturnType<typeof getDBInstance>>,
  totalSoFar: number,
  onProgress: (imported: number) => void,
): Promise<number> {
  const parser = entry.stream().pipe(parse({
    columns: true,
    skip_records_with_error: true,
    relax_quotes: true,
    trim: true,
    bom: true,
  }));

  let imported = 0;
  let batch: Record<string, unknown>[] = [];

  for await (const raw of parser as AsyncIterable<RawRecord>) {
    const record = parseRecord(raw);
    if (!record) continue;
    batch.push(record);

    if (batch.length >= 1000) {
      upsertBatch(db, batch);
      imported += batch.length;
      batch = [];
      const total = totalSoFar + imported;
      if (total % 10000 === 0) onProgress(total);
    }
  }

  if (batch.length > 0) {
    upsertBatch(db, batch);
    imported += batch.length;
  }

  return imported;
}

// Step 2: Open ZIP from disk, find ALL CSVs, parse rows, sync-insert into DB
async function importCsvFromZip(
  zipPath: string,
  db: Awaited<ReturnType<typeof getDBInstance>>,
  onProgress: (imported: number) => void,
): Promise<number> {
  const directory = await unzipper.Open.file(zipPath);

  const csvEntries = directory.files.filter(f =>
    f.path.toLowerCase().endsWith('.csv') && f.type === 'File'
  );

  if (csvEntries.length === 0) {
    const fileList = directory.files.map(f => f.path).join(', ');
    throw new Error(`ZIP 中未找到 CSV 文件。ZIP 内容: ${fileList}`);
  }

  console.log(`[KS Analytics] ZIP contents (${directory.files.length} entries):`);
  for (const f of directory.files.slice(0, 30)) {
    console.log(`  ${f.type} ${f.path} (compressed: ${fmtMB(f.compressedSize)}, uncompressed: ${fmtMB(f.uncompressedSize)})`);
  }
  if (directory.files.length > 30) console.log(`  ... and ${directory.files.length - 30} more`);
  console.log(`[KS Analytics] Found ${csvEntries.length} CSV file(s) in ZIP`);

  let totalImported = 0;
  for (const entry of csvEntries) {
    console.log(`[KS Analytics] Parsing CSV: ${entry.path} (${fmtMB(entry.uncompressedSize)})`);
    const count = await parseCsvEntry(entry, db, totalImported, onProgress);
    totalImported += count;
    console.log(`[KS Analytics] Finished ${entry.path}: ${count.toLocaleString()} records`);
    // Yield event loop between CSV files so HTTP requests can be served
    await new Promise(resolve => setImmediate(resolve));
  }

  return totalImported;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runSync(): Promise<void> {
  const startedAt = new Date().toISOString();
  updateSyncState({ status: 'running', message: '正在查找最新数据集...', progress: 2, startedAt, recordsImported: 0, error: null });

  let logId: number | undefined;
  let tmpPath: string | undefined;

  try {
    // Step 1: Get latest URL
    const url = await getLatestDatasetUrl();
    const fileName = url.split('/').pop() ?? url;
    updateSyncState({ message: `准备下载: ${fileName}`, progress: 5, lastUrl: url });
    logId = await insertSyncLog({ url, started_at: startedAt, status: 'running' });

    // Step 2: Download ZIP to temp file
    tmpPath = await downloadZip(url, (pct, downloaded, total) => {
      const progress = 5 + Math.floor(pct * 0.45); // 5% → 50%
      updateSyncState({
        message: `下载中 ${pct}% (${fmtMB(downloaded)} / ${fmtMB(total)})`,
        progress,
      });
    });

    updateSyncState({ message: '下载完成，正在解析 CSV...', progress: 52 });

    // Step 3: Pre-initialize DB (so batch inserts are synchronous)
    const db = await getDBInstance();

    // Step 4: Import CSV rows
    const totalImported = await importCsvFromZip(tmpPath, db, (imported) => {
      const progress = Math.min(52 + Math.floor(imported / 4000), 90);
      updateSyncState({
        message: `已导入 ${imported.toLocaleString()} 条记录...`,
        progress,
        recordsImported: imported,
      });
    });

    // Step 5: Save DB to disk
    updateSyncState({ message: '正在保存数据库...', progress: 93 });
    await saveDB();

    const completedAt = new Date().toISOString();
    updateSyncState({
      status: 'completed',
      message: `同步完成！共导入 ${totalImported.toLocaleString()} 条记录。`,
      progress: 100,
      completedAt,
      recordsImported: totalImported,
    });

    if (logId) {
      await updateSyncLog(logId, { completed_at: completedAt, records_imported: totalImported, status: 'completed' });
    }

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const completedAt = new Date().toISOString();
    updateSyncState({ status: 'error', message: `同步失败: ${error}`, error, completedAt, progress: 0 });
    if (logId) {
      await updateSyncLog(logId, { completed_at: completedAt, status: 'error', error_message: error });
    }
    console.error('[KS Analytics] Sync failed:', err);

  } finally {
    // Always clean up temp file
    if (tmpPath) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}
