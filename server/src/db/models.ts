import { db, nowIso, type UserRow, type StoreRow, type ScheduleRow, type BackupRow, type RunRow, type Role } from './index.js';
import { newId } from '../util/ids.js';
import { encryptSecret, decryptSecret } from '../crypto.js';

// ---- Users ----
export const Users = {
  count(): number {
    return (db.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }).n;
  },
  byEmail(email: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as UserRow | undefined;
  },
  byId(id: string): UserRow | undefined {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  },
  all(): UserRow[] {
    return db.prepare('SELECT * FROM users ORDER BY created_at').all() as UserRow[];
  },
  create(input: { email: string; name: string; passwordHash: string; role: Role }): UserRow {
    const id = newId('usr');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,is_active,email_verified,status,created_at,updated_at)
       VALUES (?,?,?,?,?,1,1,'active',?,?)`,
    ).run(id, input.email.toLowerCase(), input.name, input.passwordHash, input.role, ts, ts);
    return this.byId(id)!;
  },
  // An invited user starts pending/unverified with an unusable password hash until they accept.
  createInvited(input: { email: string; name: string; role: Role }): UserRow {
    const id = newId('usr');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO users (id,email,name,password_hash,role,is_active,email_verified,status,created_at,updated_at)
       VALUES (?,?,?,'!',?,1,0,'pending',?,?)`,
    ).run(id, input.email.toLowerCase(), input.name, input.role, ts, ts);
    return this.byId(id)!;
  },
  setPassword(id: string, passwordHash: string): void {
    db.prepare('UPDATE users SET password_hash=?, updated_at=? WHERE id=?').run(passwordHash, nowIso(), id);
  },
  activate(id: string): void {
    db.prepare(`UPDATE users SET email_verified=1, status='active', updated_at=? WHERE id=?`).run(nowIso(), id);
  },
  update(id: string, fields: Partial<Pick<UserRow, 'name' | 'role' | 'is_active' | 'password_hash'>>): void {
    const cur = this.byId(id);
    if (!cur) return;
    db.prepare('UPDATE users SET name=?, role=?, is_active=?, password_hash=?, updated_at=? WHERE id=?').run(
      fields.name ?? cur.name,
      fields.role ?? cur.role,
      fields.is_active ?? cur.is_active,
      fields.password_hash ?? cur.password_hash,
      nowIso(),
      id,
    );
  },
  remove(id: string): void {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },
};

// ---- Stores ----
export const Stores = {
  all(): StoreRow[] {
    return db.prepare('SELECT * FROM stores ORDER BY name').all() as StoreRow[];
  },
  byId(id: string): StoreRow | undefined {
    return db.prepare('SELECT * FROM stores WHERE id = ?').get(id) as StoreRow | undefined;
  },
  byDomain(domain: string): StoreRow | undefined {
    return db.prepare('SELECT * FROM stores WHERE domain = ?').get(domain) as StoreRow | undefined;
  },
  create(input: { name: string; domain: string; apiVersion: string; tokenEnc: string }): StoreRow {
    const id = newId('st');
    const ts = nowIso();
    db.prepare(
      `INSERT INTO stores (id,name,domain,api_version,token_enc,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?)`,
    ).run(id, input.name, input.domain, input.apiVersion, input.tokenEnc, ts, ts);
    return this.byId(id)!;
  },
  update(id: string, fields: Partial<Pick<StoreRow, 'name' | 'api_version' | 'token_enc' | 'drive_account_id' | 'drive_folder_id' | 'drive_folder_name'>>): void {
    const cur = this.byId(id);
    if (!cur) return;
    db.prepare(
      `UPDATE stores SET name=?, api_version=?, token_enc=?, drive_account_id=?, drive_folder_id=?, drive_folder_name=?, updated_at=? WHERE id=?`,
    ).run(
      fields.name ?? cur.name,
      fields.api_version ?? cur.api_version,
      fields.token_enc ?? cur.token_enc,
      fields.drive_account_id !== undefined ? fields.drive_account_id : cur.drive_account_id,
      fields.drive_folder_id !== undefined ? fields.drive_folder_id : cur.drive_folder_id,
      fields.drive_folder_name !== undefined ? fields.drive_folder_name : cur.drive_folder_name,
      nowIso(),
      id,
    );
  },
  remove(id: string): void {
    db.prepare('DELETE FROM stores WHERE id = ?').run(id);
  },
};

// ---- Per-store access ----
export const UserStores = {
  storesFor(userId: string): string[] {
    return (db.prepare('SELECT store_id FROM user_stores WHERE user_id = ?').all(userId) as { store_id: string }[]).map((r) => r.store_id);
  },
  set(userId: string, storeIds: string[]): void {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM user_stores WHERE user_id = ?').run(userId);
      const ins = db.prepare('INSERT OR IGNORE INTO user_stores (user_id, store_id) VALUES (?,?)');
      for (const sid of storeIds) ins.run(userId, sid);
    });
    tx();
  },
};

// ---- Schedules ----
export const Schedules = {
  byStore(storeId: string): ScheduleRow | undefined {
    return db.prepare('SELECT * FROM schedules WHERE store_id = ?').get(storeId) as ScheduleRow | undefined;
  },
  all(): ScheduleRow[] {
    return db.prepare('SELECT * FROM schedules').all() as ScheduleRow[];
  },
  upsert(storeId: string, cron: string, enabled: boolean): void {
    db.prepare(
      `INSERT INTO schedules (store_id,cron,enabled,updated_at) VALUES (?,?,?,?)
       ON CONFLICT(store_id) DO UPDATE SET cron=excluded.cron, enabled=excluded.enabled, updated_at=excluded.updated_at`,
    ).run(storeId, cron, enabled ? 1 : 0, nowIso());
  },
};

// ---- Backups ----
export const Backups = {
  create(input: { storeId: string; dir: string; source?: string; status?: string }): string {
    const id = newId('bk');
    db.prepare(
      `INSERT INTO backups (id,store_id,created_at,status,dir,source) VALUES (?,?,?,?,?,?)`,
    ).run(id, input.storeId, nowIso(), input.status ?? 'running', input.dir, input.source ?? 'backup');
    return id;
  },
  update(id: string, fields: Partial<Omit<BackupRow, 'id' | 'store_id' | 'created_at' | 'dir'>>): void {
    const cur = db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as BackupRow | undefined;
    if (!cur) return;
    db.prepare(
      `UPDATE backups SET status=?, size_bytes=?, counts_json=?, checksum_ok=?, drive_status=?, drive_file_id=?, manifest_json=? WHERE id=?`,
    ).run(
      fields.status ?? cur.status,
      fields.size_bytes ?? cur.size_bytes,
      fields.counts_json ?? cur.counts_json,
      fields.checksum_ok ?? cur.checksum_ok,
      fields.drive_status ?? cur.drive_status,
      fields.drive_file_id !== undefined ? fields.drive_file_id : cur.drive_file_id,
      fields.manifest_json ?? cur.manifest_json,
      id,
    );
  },
  byId(id: string): BackupRow | undefined {
    return db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as BackupRow | undefined;
  },
  forStore(storeId: string): BackupRow[] {
    return db.prepare('SELECT * FROM backups WHERE store_id = ? ORDER BY created_at DESC').all(storeId) as BackupRow[];
  },
  remove(id: string): void {
    db.prepare('DELETE FROM backups WHERE id = ?').run(id);
  },
};

// ---- Runs ----
export const Runs = {
  create(input: { storeId: string; type: 'backup' | 'restore'; trigger: string; userId?: string | null }): string {
    const id = newId('run');
    db.prepare(
      `INSERT INTO runs (id,store_id,type,status,trigger,started_at,user_id) VALUES (?,?,?,?,?,?,?)`,
    ).run(id, input.storeId, input.type, 'running', input.trigger, nowIso(), input.userId ?? null);
    return id;
  },
  finish(id: string, status: 'completed' | 'failed', opts: { error?: string; backupId?: string } = {}): void {
    db.prepare('UPDATE runs SET status=?, finished_at=?, error=?, backup_id=? WHERE id=?').run(
      status, nowIso(), opts.error ?? null, opts.backupId ?? null, id,
    );
  },
  recent(storeId: string, limit = 20): RunRow[] {
    return db.prepare('SELECT * FROM runs WHERE store_id = ? ORDER BY started_at DESC LIMIT ?').all(storeId, limit) as RunRow[];
  },
  byId(id: string): RunRow | undefined {
    return db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
  },
  byBackupId(backupId: string): RunRow | undefined {
    return db.prepare('SELECT * FROM runs WHERE backup_id = ? ORDER BY started_at DESC LIMIT 1').get(backupId) as RunRow | undefined;
  },
};

// ---- Logs ----
export const Logs = {
  query(filter: { storeId?: string; runId?: string; level?: string; limit?: number }): any[] {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.storeId) { clauses.push('store_id = ?'); params.push(filter.storeId); }
    if (filter.runId) { clauses.push('run_id = ?'); params.push(filter.runId); }
    if (filter.level) { clauses.push('level = ?'); params.push(filter.level); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(filter.limit ?? 500);
    return db.prepare(`SELECT * FROM logs ${where} ORDER BY id DESC LIMIT ?`).all(...params);
  },
};

// ---- Settings (key/value; secrets encrypted) ----
export interface SmtpConfig { host: string; port: number; secure: boolean; user: string; pass: string; from: string; }

export const Settings = {
  get(key: string): string | undefined {
    return (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  },
  set(key: string, value: string): void {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  },
  getSmtp(): SmtpConfig | null {
    const v = this.get('smtp');
    if (!v) return null;
    try { return JSON.parse(decryptSecret(v)) as SmtpConfig; } catch { return null; }
  },
  setSmtp(cfg: SmtpConfig): void {
    this.set('smtp', encryptSecret(JSON.stringify(cfg)));
  },
};
