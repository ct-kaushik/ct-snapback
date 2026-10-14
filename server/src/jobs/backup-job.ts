import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decryptSecret } from '../crypto.js';
import { Backups, Runs } from '../db/models.js';
import { db, type StoreRow } from '../db/index.js';
import { ShopifyClient } from '../shopify/client.js';
import { runExport } from '../export/run.js';
import { makeReporter, type Reporter } from './reporter.js';
import { hub } from '../events.js';
import { zipDir } from '../storage/local.js';
import { uploadFile } from '../storage/gdrive.js';

export function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface BackupJobParams {
  store: StoreRow;
  runId: string;
  backupId: string;
  dir: string;
  totalSteps: number;
  willUploadDrive: boolean;
}

/** Executes an already-registered backup run. Runner handles row creation + concurrency. */
export async function runBackupJob(p: BackupJobParams): Promise<void> {
  const { store, runId, backupId, dir } = p;
  const reporter = makeReporter(runId, store.id, p.totalSteps);
  hub.publish({ kind: 'run', storeId: store.id, runId, runType: 'backup', status: 'running', backupId });
  reporter.log.info(`Backup started for ${store.domain}`);

  try {
    const client = new ShopifyClient({ domain: store.domain, token: decryptSecret(store.token_enc), apiVersion: store.api_version });

    // runExport advances the reporter through its own 5 phases.
    const result = await runExport(
      client,
      { name: store.name, domain: store.domain, apiVersion: store.api_version },
      dir,
      reporter,
    );

    Backups.update(backupId, {
      status: 'completed',
      size_bytes: result.sizeBytes,
      counts_json: JSON.stringify(result.counts),
      checksum_ok: result.checksumOk ? 1 : 0,
      manifest_json: JSON.stringify(result.manifest),
    });
    reporter.log.info(`Export complete. Size ${(result.sizeBytes / 1024).toFixed(1)} KiB, checksums ${result.checksumOk ? 'OK' : 'MISMATCH'}`);

    if (p.willUploadDrive) {
      await uploadToDrive(store, dir, backupId, reporter);
    }

    Runs.finish(runId, 'completed', { backupId });
    hub.publish({ kind: 'run', storeId: store.id, runId, runType: 'backup', status: 'completed', backupId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.log.error(`Backup failed: ${message}`);
    Backups.update(backupId, { status: 'failed' });
    Runs.finish(runId, 'failed', { error: message, backupId });
    hub.publish({ kind: 'run', storeId: store.id, runId, runType: 'backup', status: 'failed', backupId, error: message });
    throw err;
  }
}

async function uploadToDrive(store: StoreRow, dir: string, backupId: string, reporter: Reporter) {
  reporter.phase('Google Drive upload');
  try {
    const account = db.prepare('SELECT refresh_token_enc FROM drive_accounts WHERE id = ?').get(store.drive_account_id) as { refresh_token_enc: string } | undefined;
    if (!account) throw new Error('Linked Google account not found');
    Backups.update(backupId, { drive_status: 'uploading' });
    const zipName = `${path.basename(dir)}.zip`;
    const zipPath = path.join(os.tmpdir(), `${sanitize(store.domain)}_${zipName}`); // outside the backup dir
    reporter.determinate(0, 1, 'Zipping backup');
    await zipDir(dir, zipPath);
    reporter.determinate(0, 1, 'Uploading to Google Drive');
    const fileId = await uploadFile(decryptSecret(account.refresh_token_enc), store.drive_folder_id!, zipPath, `${sanitize(store.domain)}_${zipName}`);
    fs.rmSync(zipPath, { force: true });
    Backups.update(backupId, { drive_status: 'uploaded', drive_file_id: fileId });
    reporter.determinate(1, 1, 'Uploaded to Google Drive');
    reporter.log.info(`Uploaded backup to Google Drive (${store.drive_folder_name ?? store.drive_folder_id})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    Backups.update(backupId, { drive_status: 'failed' });
    reporter.log.warn(`Google Drive upload failed: ${message}`);
  }
}
