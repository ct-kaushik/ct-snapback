import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import archiver from 'archiver';
import { z } from 'zod';
import { config } from '../config.js';
import { encryptSecret, decryptSecret, maskSecret } from '../crypto.js';
import { hashPassword, verifyPassword, createSession, destroySession, SESSION_COOKIE } from '../auth/index.js';
import { createAuthToken, consumeAuthToken } from '../auth/tokens.js';
import { Users, Stores, UserStores, Schedules, Backups, Runs, Logs, Settings, type SmtpConfig } from '../db/models.js';
import { sendMail, verifySmtp, smtpConfigured, emailTemplates } from '../util/mailer.js';
import { log } from '../util/logger.js';
import { db } from '../db/index.js';
import { newId } from '../util/ids.js';
import { currentUser, requireUser, requireRole, requireStoreAccess, canAccessStore, handler, publicUser, HttpError } from './context.js';
import { startBackup, startRestore, isStoreBusy } from '../jobs/runner.js';
import { reschedule } from '../jobs/scheduler.js';
import { ShopifyClient } from '../shopify/client.js';
import { SHOP_QUERY } from '../shopify/gql.js';
import { FILES } from '../export/schema.js';
import { loadBackup } from '../import/loader.js';
import { dirSize, unzipToDir } from '../storage/local.js';
import { hub } from '../events.js';
import * as gdrive from '../storage/gdrive.js';

function serializeStore(storeId: string) {
  const s = Stores.byId(storeId)!;
  const sched = Schedules.byStore(storeId);
  const runs = Runs.recent(storeId, 1);
  return {
    id: s.id,
    name: s.name,
    domain: s.domain,
    apiVersion: s.api_version,
    tokenMasked: maskSecret(decryptSecret(s.token_enc)),
    schedule: sched ? { cron: sched.cron, enabled: Boolean(sched.enabled) } : { cron: '0 3 * * 1', enabled: false },
    drive: { accountId: s.drive_account_id, folderId: s.drive_folder_id, folderName: s.drive_folder_name },
    lastRun: runs[0] ? { id: runs[0].id, type: runs[0].type, status: runs[0].status, startedAt: runs[0].started_at } : null,
    busy: isStoreBusy(storeId),
  };
}

function serializeBackup(id: string) {
  const b = Backups.byId(id)!;
  const run = Runs.byBackupId(b.id);
  return {
    id: b.id,
    storeId: b.store_id,
    createdAt: b.created_at,
    status: b.status,
    sizeBytes: b.size_bytes,
    counts: JSON.parse(b.counts_json || '{}'),
    checksumOk: Boolean(b.checksum_ok),
    driveStatus: b.drive_status,
    driveFileId: b.drive_file_id,
    runId: run?.id ?? null,
    source: b.source ?? 'backup',
  };
}

export function registerApi(app: FastifyInstance): void {
  // ---------------- Session / setup / auth ----------------
  app.get('/api/session', handler((req) => {
    const user = currentUser(req);
    return {
      user: user ? publicUser(user) : null,
      setupRequired: Users.count() === 0,
      driveEnabled: gdrive.driveEnabled(),
      smtpConfigured: smtpConfigured(),
    };
  }));

  app.post('/api/setup', handler(async (req, reply) => {
    if (Users.count() > 0) throw new HttpError(409, 'Setup already completed');
    const body = z.object({ email: z.string().email(), name: z.string().min(1), password: z.string().min(8) }).parse(req.body);
    const user = Users.create({ email: body.email, name: body.name, passwordHash: await hashPassword(body.password), role: 'admin' });
    const sid = createSession(user.id);
    reply.setCookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', path: '/', secure: config.isProd });
    return { user: publicUser(user) };
  }));

  app.post('/api/login', handler(async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = Users.byEmail(body.email);
    if (!user || !user.is_active || !(await verifyPassword(body.password, user.password_hash))) {
      throw new HttpError(401, 'Invalid email or password');
    }
    if (!user.email_verified || user.status !== 'active') {
      throw new HttpError(403, 'Your account isn’t active yet — check your email for the invite/verification link.');
    }
    const sid = createSession(user.id);
    reply.setCookie(SESSION_COOKIE, sid, { httpOnly: true, sameSite: 'lax', path: '/', secure: config.isProd });
    return { user: publicUser(user) };
  }));

  app.post('/api/logout', handler((req, reply) => {
    destroySession((req.cookies as Record<string, string>)[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }));

  // ---------------- Users (admin) ----------------
  app.get('/api/users', handler((req) => {
    requireRole(req, 'admin');
    return Users.all().map((u) => ({
      ...publicUser(u), isActive: Boolean(u.is_active), emailVerified: Boolean(u.email_verified),
      status: u.status, storeIds: UserStores.storesFor(u.id), createdAt: u.created_at,
    }));
  }));

  // Invite a new user: creates a pending account and emails a set-password link (which also verifies).
  app.post('/api/users', handler(async (req) => {
    requireRole(req, 'admin');
    const body = z.object({
      email: z.string().email(), name: z.string().min(1),
      role: z.enum(['admin', 'operator', 'viewer']), storeIds: z.array(z.string()).default([]),
    }).parse(req.body);
    if (Users.byEmail(body.email)) throw new HttpError(409, 'Email already in use');
    const user = Users.createInvited({ email: body.email, name: body.name, role: body.role });
    UserStores.set(user.id, body.storeIds);
    const inviteUrl = `${config.baseUrl}/invite/accept?token=${createAuthToken(user.id, 'invite')}`;
    let emailed = false;
    if (smtpConfigured()) {
      try { await sendMail(user.email, 'You’re invited to Coalition Snapback', emailTemplates.invite(user.name, inviteUrl)); emailed = true; }
      catch (e) { log.warn(`Invite email failed for ${user.email}: ${(e as Error).message}`); }
    }
    // If email couldn't be sent, return the link so the admin can share it manually.
    return { ...publicUser(user), storeIds: body.storeIds, emailed, inviteUrl: emailed ? undefined : inviteUrl };
  }));

  app.post('/api/users/:id/resend-invite', handler(async (req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const user = Users.byId(id);
    if (!user) throw new HttpError(404, 'User not found');
    const inviteUrl = `${config.baseUrl}/invite/accept?token=${createAuthToken(user.id, 'invite')}`;
    let emailed = false;
    if (smtpConfigured()) {
      try { await sendMail(user.email, 'Your Coalition Snapback invite', emailTemplates.invite(user.name, inviteUrl)); emailed = true; }
      catch (e) { log.warn(`Resend invite failed for ${user.email}: ${(e as Error).message}`); }
    }
    return { emailed, inviteUrl: emailed ? undefined : inviteUrl };
  }));

  app.patch('/api/users/:id', handler(async (req) => {
    const me = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const body = z.object({
      name: z.string().optional(), role: z.enum(['admin', 'operator', 'viewer']).optional(),
      isActive: z.boolean().optional(), password: z.string().min(8).optional(), storeIds: z.array(z.string()).optional(),
    }).parse(req.body);
    const target = Users.byId(id);
    if (!target) throw new HttpError(404, 'User not found');
    if (target.id === me.id && body.role && body.role !== 'admin') throw new HttpError(400, 'You cannot demote yourself');
    Users.update(id, {
      name: body.name,
      role: body.role,
      is_active: body.isActive === undefined ? undefined : body.isActive ? 1 : 0,
      password_hash: body.password ? await hashPassword(body.password) : undefined,
    });
    if (body.storeIds) UserStores.set(id, body.storeIds);
    return { ok: true };
  }));

  app.delete('/api/users/:id', handler((req) => {
    const me = requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    if (id === me.id) throw new HttpError(400, 'You cannot delete yourself');
    Users.remove(id);
    return { ok: true };
  }));

  // ---------------- Public account flows (invite / reset) ----------------
  app.post('/api/invite/accept', handler(async (req) => {
    const body = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);
    const userId = consumeAuthToken(body.token, 'invite');
    if (!userId) throw new HttpError(400, 'This invite link is invalid or has expired. Ask an admin to resend it.');
    Users.setPassword(userId, await hashPassword(body.password));
    Users.activate(userId);
    return { ok: true };
  }));

  app.post('/api/password/forgot', handler(async (req) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const user = Users.byEmail(body.email);
    if (user && user.is_active && smtpConfigured()) {
      const url = `${config.baseUrl}/reset?token=${createAuthToken(user.id, 'reset')}`;
      try { await sendMail(user.email, 'Reset your Coalition Snapback password', emailTemplates.reset(user.name, url)); }
      catch (e) { log.warn(`Reset email failed for ${user.email}: ${(e as Error).message}`); }
    }
    // Always generic — never reveal whether the account exists.
    return { ok: true };
  }));

  app.post('/api/password/reset', handler(async (req) => {
    const body = z.object({ token: z.string(), password: z.string().min(8) }).parse(req.body);
    const userId = consumeAuthToken(body.token, 'reset');
    if (!userId) throw new HttpError(400, 'This reset link is invalid or has expired.');
    Users.setPassword(userId, await hashPassword(body.password));
    Users.activate(userId);
    const u = Users.byId(userId);
    if (u && smtpConfigured()) { try { await sendMail(u.email, 'Your password was changed', emailTemplates.resetConfirm(u.name)); } catch { /* ignore */ } }
    return { ok: true };
  }));

  // ---------------- SMTP settings (admin) ----------------
  app.get('/api/settings/smtp', handler((req) => {
    requireRole(req, 'admin');
    const s = Settings.getSmtp();
    return {
      host: s?.host ?? '', port: s?.port ?? 587, secure: s?.secure ?? false,
      user: s?.user ?? '', from: s?.from ?? '', hasPassword: Boolean(s?.pass), configured: smtpConfigured(),
    };
  }));

  app.put('/api/settings/smtp', handler(async (req) => {
    requireRole(req, 'admin');
    const body = z.object({
      host: z.string().min(1), port: z.coerce.number().int().positive(), secure: z.boolean(),
      user: z.string().default(''), pass: z.string().optional(), from: z.string().default(''),
    }).parse(req.body);
    const cur = Settings.getSmtp();
    const cfg: SmtpConfig = { host: body.host, port: body.port, secure: body.secure, user: body.user, from: body.from, pass: body.pass && body.pass !== '' ? body.pass : (cur?.pass ?? '') };
    await verifySmtp(cfg); // fail fast if the connection/auth is wrong
    Settings.setSmtp(cfg);
    return { ok: true };
  }));

  app.post('/api/settings/smtp/test', handler(async (req) => {
    requireRole(req, 'admin');
    const body = z.object({ to: z.string().email() }).parse(req.body);
    await sendMail(body.to, 'Coalition Snapback — SMTP test', emailTemplates.test());
    return { ok: true };
  }));

  // ---------------- Stores ----------------
  app.get('/api/stores', handler((req) => {
    const user = requireUser(req);
    const ids = user.role === 'admin' ? Stores.all().map((s) => s.id) : UserStores.storesFor(user.id);
    return ids.map(serializeStore);
  }));

  app.post('/api/stores', handler((req) => {
    requireRole(req, 'admin');
    const body = z.object({
      name: z.string().min(1),
      domain: z.string().min(3),
      apiVersion: z.string().default(config.defaultApiVersion),
      token: z.string().min(10),
    }).parse(req.body);
    const domain = body.domain.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (Stores.byDomain(domain)) throw new HttpError(409, 'A store with this domain already exists');
    const store = Stores.create({ name: body.name, domain, apiVersion: body.apiVersion, tokenEnc: encryptSecret(body.token) });
    return serializeStore(store.id);
  }));

  app.patch('/api/stores/:id', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    if (!Stores.byId(id)) throw new HttpError(404, 'Store not found');
    const body = z.object({ name: z.string().optional(), apiVersion: z.string().optional(), token: z.string().min(10).optional() }).parse(req.body);
    Stores.update(id, {
      name: body.name,
      api_version: body.apiVersion,
      token_enc: body.token ? encryptSecret(body.token) : undefined,
    });
    return serializeStore(id);
  }));

  app.delete('/api/stores/:id', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    Stores.remove(id);
    reschedule(id);
    return { ok: true };
  }));

  app.post('/api/stores/:id/test', handler(async (req) => {
    const { id } = req.params as { id: string };
    requireStoreAccess(req, id, 'viewer');
    const store = Stores.byId(id);
    if (!store) throw new HttpError(404, 'Store not found');
    const client = new ShopifyClient({ domain: store.domain, token: decryptSecret(store.token_enc), apiVersion: store.api_version });
    const { data } = await client.graphql(SHOP_QUERY);
    return { ok: true, shop: data.shop };
  }));

  // Schedule (admin)
  app.put('/api/stores/:id/schedule', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    if (!Stores.byId(id)) throw new HttpError(404, 'Store not found');
    const body = z.object({ cron: z.string().min(1), enabled: z.boolean() }).parse(req.body);
    Schedules.upsert(id, body.cron, body.enabled);
    reschedule(id);
    return serializeStore(id);
  }));

  // Per-store Google Drive destination (admin)
  app.put('/api/stores/:id/drive', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    if (!Stores.byId(id)) throw new HttpError(404, 'Store not found');
    const body = z.object({ accountId: z.string().nullable(), folderId: z.string().nullable(), folderName: z.string().nullable() }).parse(req.body);
    Stores.update(id, { drive_account_id: body.accountId, drive_folder_id: body.folderId, drive_folder_name: body.folderName });
    return serializeStore(id);
  }));

  // Create/use a dedicated "Shopify Backups/<domain>" folder (works with the drive.file scope).
  app.post('/api/stores/:id/drive/default', handler(async (req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const store = Stores.byId(id);
    if (!store) throw new HttpError(404, 'Store not found');
    const body = z.object({ accountId: z.string() }).parse(req.body);
    const acc = db.prepare('SELECT refresh_token_enc FROM drive_accounts WHERE id = ?').get(body.accountId) as { refresh_token_enc: string } | undefined;
    if (!acc) throw new HttpError(404, 'Drive account not found');
    const token = decryptSecret(acc.refresh_token_enc);
    const root = await gdrive.ensureFolder(token, 'Coalition Snapback');
    const sub = await gdrive.ensureFolder(token, store.domain, root.id);
    Stores.update(id, { drive_account_id: body.accountId, drive_folder_id: sub.id, drive_folder_name: `Coalition Snapback/${store.domain}` });
    return serializeStore(id);
  }));

  // Unlink Drive from a store.
  app.delete('/api/stores/:id/drive', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    if (!Stores.byId(id)) throw new HttpError(404, 'Store not found');
    Stores.update(id, { drive_account_id: null, drive_folder_id: null, drive_folder_name: null });
    return serializeStore(id);
  }));

  // ---------------- Backups ----------------
  app.get('/api/stores/:id/backups', handler((req) => {
    const { id } = req.params as { id: string };
    requireStoreAccess(req, id, 'viewer');
    return Backups.forStore(id).map((b) => serializeBackup(b.id));
  }));

  app.post('/api/stores/:id/backups', handler((req) => {
    const { id } = req.params as { id: string };
    const user = requireStoreAccess(req, id, 'operator');
    const result = startBackup(id, 'manual', user.id);
    return result;
  }));

  // Upload an (optionally edited) backup zip and register it as a restore source.
  app.post('/api/stores/:id/imports', handler(async (req) => {
    const { id } = req.params as { id: string };
    requireStoreAccess(req, id, 'operator');
    if (!Stores.byId(id)) throw new HttpError(404, 'Store not found');

    const file = await (req as any).file();
    if (!file) throw new HttpError(400, 'No file uploaded (send a .zip in the "file" field)');

    const importsRoot = path.join(config.dataDir, 'imports');
    fs.mkdirSync(importsRoot, { recursive: true });
    const dir = path.join(importsRoot, newId('imp'));
    fs.mkdirSync(dir, { recursive: true });
    const tmpZip = path.join(dir, '_upload.zip');

    try {
      await pipeline(file.file, fs.createWriteStream(tmpZip));
      if ((file as any).file?.truncated) throw new HttpError(413, 'Upload exceeded the size limit');
      unzipToDir(tmpZip, dir);
      fs.rmSync(tmpZip, { force: true });

      const hasProducts = fs.existsSync(path.join(dir, FILES.products));
      const hasCollections = fs.existsSync(path.join(dir, FILES.collections));
      if (!hasProducts && !hasCollections) {
        throw new HttpError(400, 'Not a valid Coalition Snapback backup — products.csv or collections.csv is required.');
      }

      const bd = loadBackup(dir);
      const counts = {
        products: bd.products.length,
        variants: bd.variants.length,
        collections: bd.collections.length,
        metafields: bd.metafields.length,
        metaobjects: bd.metaobjects.length,
        inventory_levels: bd.inventoryLevels.length,
      };
      const bkId = Backups.create({ storeId: id, dir, source: 'uploaded', status: 'completed' });
      Backups.update(bkId, { size_bytes: dirSize(dir), counts_json: JSON.stringify(counts), checksum_ok: 1 });
      return { id: bkId, counts };
    } catch (err) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw err;
    }
  }));

  app.get('/api/stores/:id/runs', handler((req) => {
    const { id } = req.params as { id: string };
    requireStoreAccess(req, id, 'viewer');
    return Runs.recent(id, 30).map((r) => ({
      id: r.id, type: r.type, status: r.status, trigger: r.trigger,
      startedAt: r.started_at, finishedAt: r.finished_at, error: r.error, backupId: r.backup_id,
    }));
  }));

  app.get('/api/backups/:id', handler((req) => {
    const { id } = req.params as { id: string };
    const b = Backups.byId(id);
    if (!b) throw new HttpError(404, 'Backup not found');
    requireStoreAccess(req, b.store_id, 'viewer');
    return { ...serializeBackup(id), manifest: b.manifest_json ? JSON.parse(b.manifest_json) : null };
  }));

  app.get('/api/backups/:id/files', handler((req) => {
    const { id } = req.params as { id: string };
    const b = Backups.byId(id);
    if (!b) throw new HttpError(404, 'Backup not found');
    requireStoreAccess(req, b.store_id, 'viewer');
    if (!fs.existsSync(b.dir)) return [];
    return fs.readdirSync(b.dir).filter((f) => fs.statSync(path.join(b.dir, f)).isFile())
      .map((f) => ({ name: f, bytes: fs.statSync(path.join(b.dir, f)).size }));
  }));

  app.get('/api/backups/:id/download/:file', handler((req, reply) => {
    const { id, file } = req.params as { id: string; file: string };
    const b = Backups.byId(id);
    if (!b) throw new HttpError(404, 'Backup not found');
    requireStoreAccess(req, b.store_id, 'viewer');
    const safe = path.basename(file);
    const full = path.join(b.dir, safe);
    if (!fs.existsSync(full)) throw new HttpError(404, 'File not found');
    reply.header('Content-Disposition', `attachment; filename="${safe}"`);
    reply.type(safe.endsWith('.json') ? 'application/json' : 'text/csv');
    return reply.send(fs.createReadStream(full));
  }));

  app.get('/api/backups/:id/download', handler((req, reply) => {
    const { id } = req.params as { id: string };
    const b = Backups.byId(id);
    if (!b) throw new HttpError(404, 'Backup not found');
    requireStoreAccess(req, b.store_id, 'viewer');
    reply.header('Content-Disposition', `attachment; filename="backup_${id}.zip"`);
    reply.type('application/zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.directory(b.dir, false); // includes CSVs + the images/ subfolder
    archive.finalize();
    return reply.send(archive);
  }));

  app.delete('/api/backups/:id', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    const b = Backups.byId(id);
    if (!b) throw new HttpError(404, 'Backup not found');
    fs.rmSync(b.dir, { recursive: true, force: true });
    Backups.remove(id);
    return { ok: true };
  }));

  // ---------------- Restore ----------------
  app.post('/api/restore', handler((req) => {
    const user = requireRole(req, 'operator');
    const body = z.object({
      sourceBackupId: z.string(),
      targetStoreId: z.string(),
      dryRun: z.boolean().default(true),
      conflictMode: z.enum(['overwrite', 'skip']).default('overwrite'),
      resources: z.object({
        definitions: z.boolean().default(true),
        metaobjects: z.boolean().default(true),
        products: z.boolean().default(true),
        collections: z.boolean().default(true),
        metafields: z.boolean().default(true),
        inventory: z.boolean().default(true),
      }),
    }).parse(req.body);

    const backup = Backups.byId(body.sourceBackupId);
    if (!backup) throw new HttpError(404, 'Source backup not found');
    if (!canAccessStore(user, backup.store_id)) throw new HttpError(403, 'No access to the source backup');
    if (!canAccessStore(user, body.targetStoreId)) throw new HttpError(403, 'No access to the target store');

    return startRestore({ ...body, userId: user.id });
  }));

  // ---------------- Logs ----------------
  app.get('/api/logs', handler((req) => {
    const user = requireUser(req);
    const q = req.query as { storeId?: string; runId?: string; level?: string; limit?: string };
    if (q.storeId && !canAccessStore(user, q.storeId)) throw new HttpError(403, 'No access to this store');
    return Logs.query({ storeId: q.storeId, runId: q.runId, level: q.level, limit: q.limit ? Number(q.limit) : 500 });
  }));

  // ---------------- Google Drive ----------------
  app.get('/api/drive/status', handler((req) => {
    requireUser(req);
    const accounts = gdrive.driveEnabled()
      ? (db.prepare('SELECT id, email FROM drive_accounts ORDER BY created_at').all() as { id: string; email: string }[])
      : [];
    return { enabled: gdrive.driveEnabled(), accounts };
  }));

  app.get('/api/drive/connect', (req, reply) => {
    const user = currentUser(req);
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'Admin only' });
    if (!gdrive.driveEnabled()) return reply.code(400).send({ error: 'Google Drive is not configured (set GOOGLE_CLIENT_ID/SECRET).' });
    return reply.redirect(gdrive.authUrl('connect'));
  });

  app.get('/api/drive/oauth/callback', async (req, reply) => {
    try {
      const { code } = req.query as { code?: string };
      if (!code) return reply.code(400).send('Missing code');
      const { refreshToken, email } = await gdrive.exchangeCode(code);
      db.prepare('INSERT INTO drive_accounts (id,email,refresh_token_enc,created_at) VALUES (?,?,?,?)')
        .run(newId('gd'), email, encryptSecret(refreshToken), new Date().toISOString());
      return reply.redirect('/drive?connected=1');
    } catch (err) {
      return reply.code(400).send(`Google Drive connection failed: ${(err as Error).message}`);
    }
  });

  app.get('/api/drive/folders', handler(async (req) => {
    requireRole(req, 'admin');
    const q = req.query as { accountId?: string; parentId?: string };
    if (!q.accountId) throw new HttpError(400, 'accountId required');
    const acc = db.prepare('SELECT refresh_token_enc FROM drive_accounts WHERE id = ?').get(q.accountId) as { refresh_token_enc: string } | undefined;
    if (!acc) throw new HttpError(404, 'Drive account not found');
    return gdrive.listFolders(decryptSecret(acc.refresh_token_enc), q.parentId);
  }));

  app.delete('/api/drive/accounts/:id', handler((req) => {
    requireRole(req, 'admin');
    const { id } = req.params as { id: string };
    db.prepare('DELETE FROM drive_accounts WHERE id = ?').run(id);
    return { ok: true };
  }));

  // ---------------- SSE live events ----------------
  app.get('/api/events', (req, reply) => {
    const user = currentUser(req);
    if (!user) {
      reply.code(401).send({ error: 'Not authenticated' });
      return;
    }
    const q = req.query as { storeId?: string };
    const allowed = user.role === 'admin' ? null : new Set(UserStores.storesFor(user.id));

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    raw.write(': connected\n\n');

    const unsub = hub.subscribe((ev) => {
      const evStore = (ev as { storeId?: string | null }).storeId ?? null;
      if (q.storeId && evStore && evStore !== q.storeId) return;
      if (allowed && evStore && !allowed.has(evStore)) return;
      raw.write(`data: ${JSON.stringify(ev)}\n\n`);
    });
    const ping = setInterval(() => raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => {
      clearInterval(ping);
      unsub();
    });
  });
}
