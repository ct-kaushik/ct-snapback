import Database from 'better-sqlite3';
import { config } from '../config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Create tables if they don't exist. Safe to run on every boot. */
export function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'viewer',   -- admin | operator | viewer
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drive_accounts (
      id                TEXT PRIMARY KEY,
      email             TEXT NOT NULL,
      refresh_token_enc TEXT NOT NULL,
      created_at        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stores (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      domain       TEXT NOT NULL UNIQUE,             -- xxx.myshopify.com
      api_version  TEXT NOT NULL,
      token_enc    TEXT NOT NULL,
      drive_account_id TEXT REFERENCES drive_accounts(id) ON DELETE SET NULL,
      drive_folder_id  TEXT,
      drive_folder_name TEXT,
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_stores (
      user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, store_id)
    );

    CREATE TABLE IF NOT EXISTS schedules (
      store_id   TEXT PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
      cron       TEXT NOT NULL,
      enabled    INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id            TEXT PRIMARY KEY,
      store_id      TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      created_at    TEXT NOT NULL,
      status        TEXT NOT NULL,                   -- running | completed | failed
      dir           TEXT NOT NULL,
      size_bytes    INTEGER NOT NULL DEFAULT 0,
      counts_json   TEXT NOT NULL DEFAULT '{}',
      checksum_ok   INTEGER NOT NULL DEFAULT 0,
      drive_status  TEXT NOT NULL DEFAULT 'none',    -- none | uploading | uploaded | failed
      drive_file_id TEXT,
      manifest_json TEXT
    );

    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      store_id    TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,                     -- backup | restore
      status      TEXT NOT NULL,                     -- running | completed | failed
      trigger     TEXT NOT NULL DEFAULT 'manual',    -- manual | scheduled
      started_at  TEXT NOT NULL,
      finished_at TEXT,
      error       TEXT,
      backup_id   TEXT,
      user_id     TEXT
    );

    CREATE TABLE IF NOT EXISTS logs (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id       TEXT,
      store_id     TEXT,
      ts           TEXT NOT NULL,
      level        TEXT NOT NULL,                    -- debug | info | warn | error
      phase        TEXT,
      message      TEXT NOT NULL,
      context_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_logs_run ON logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_logs_store ON logs(store_id);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      purpose    TEXT NOT NULL,                    -- invite | verify | reset
      expires_at TEXT NOT NULL,
      used_at    TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tokens_hash ON auth_tokens(token_hash);
  `);

  // ---- v2 idempotent column migrations (ignore "duplicate column" on re-run) ----
  for (const alter of [
    `ALTER TABLE backups ADD COLUMN source TEXT NOT NULL DEFAULT 'backup'`,
    // Existing users default to verified/active so nobody is locked out by the upgrade.
    `ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
  ]) {
    try { db.exec(alter); } catch { /* column already exists */ }
  }
}

// ---- Row types ----
export type Role = 'admin' | 'operator' | 'viewer';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  role: Role;
  is_active: number;
  email_verified: number;
  status: string; // active | pending
  created_at: string;
  updated_at: string;
}

export interface AuthTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  purpose: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface StoreRow {
  id: string;
  name: string;
  domain: string;
  api_version: string;
  token_enc: string;
  drive_account_id: string | null;
  drive_folder_id: string | null;
  drive_folder_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleRow {
  store_id: string;
  cron: string;
  enabled: number;
  updated_at: string;
}

export interface BackupRow {
  id: string;
  store_id: string;
  created_at: string;
  status: string;
  dir: string;
  size_bytes: number;
  counts_json: string;
  checksum_ok: number;
  drive_status: string;
  drive_file_id: string | null;
  manifest_json: string | null;
  source: string; // backup | uploaded
}

export interface RunRow {
  id: string;
  store_id: string;
  type: string;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  backup_id: string | null;
  user_id: string | null;
}

export function nowIso(): string {
  return new Date().toISOString();
}
