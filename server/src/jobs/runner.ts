import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { Stores, Runs, Backups } from '../db/models.js';
import { driveEnabled } from '../storage/gdrive.js';
import { runBackupJob, sanitize } from './backup-job.js';
import { runRestoreJob, countRestoreSteps, type RestoreOptions } from './restore-job.js';
import { log } from '../util/logger.js';

// storeId -> runId currently executing (single-flight per store).
const running = new Map<string, string>();

export function isStoreBusy(storeId: string): boolean {
  return running.has(storeId);
}

export function startBackup(storeId: string, trigger: 'manual' | 'scheduled', userId?: string | null): { runId: string; backupId: string } {
  const store = Stores.byId(storeId);
  if (!store) throw new Error('Store not found');
  if (running.has(storeId)) throw new Error('A job is already running for this store');

  const willUploadDrive = Boolean(driveEnabled() && store.drive_account_id && store.drive_folder_id);
  // Export phases: Products, Variant metafields, Collections, Metafield definitions, Metaobjects, Inventory, Themes.
  const totalSteps = 7 + (willUploadDrive ? 1 : 0);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(config.backupsDir, sanitize(store.domain), ts);
  fs.mkdirSync(dir, { recursive: true });

  const runId = Runs.create({ storeId, type: 'backup', trigger, userId });
  const backupId = Backups.create({ storeId, dir });
  running.set(storeId, runId);

  runBackupJob({ store, runId, backupId, dir, totalSteps, willUploadDrive })
    .catch((err) => log.error(`Backup job crashed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => running.delete(storeId));

  return { runId, backupId };
}

export function startRestore(opts: RestoreOptions): { runId: string } {
  const target = Stores.byId(opts.targetStoreId);
  if (!target) throw new Error('Target store not found');
  if (running.has(opts.targetStoreId)) throw new Error('A job is already running for the target store');

  const runId = Runs.create({ storeId: opts.targetStoreId, type: 'restore', trigger: 'manual', userId: opts.userId });
  running.set(opts.targetStoreId, runId);

  runRestoreJob({ ...opts, runId })
    .catch((err) => log.error(`Restore job crashed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => running.delete(opts.targetStoreId));

  return { runId };
}

export { countRestoreSteps };
