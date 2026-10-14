import cron, { type ScheduledTask } from 'node-cron';
import { config } from '../config.js';
import { Schedules, Stores } from '../db/models.js';
import { startBackup, isStoreBusy } from './runner.js';
import { log } from '../util/logger.js';

const tasks = new Map<string, ScheduledTask>();

/** (Re)register the cron task for a store based on its schedule row. */
export function reschedule(storeId: string): void {
  tasks.get(storeId)?.stop();
  tasks.delete(storeId);

  const sched = Schedules.byStore(storeId);
  if (!sched || !sched.enabled) return;
  if (!cron.validate(sched.cron)) {
    log.warn(`Invalid cron for store ${storeId}: ${sched.cron}`);
    return;
  }

  const task = cron.schedule(
    sched.cron,
    () => {
      const store = Stores.byId(storeId);
      if (!store) return;
      if (isStoreBusy(storeId)) {
        log.warn(`Scheduled backup skipped for ${store.domain} — a job is already running`);
        return;
      }
      log.info(`Scheduled backup triggered for ${store.domain}`);
      try {
        startBackup(storeId, 'scheduled', null);
      } catch (err) {
        log.error(`Failed to start scheduled backup for ${store.domain}: ${(err as Error).message}`);
      }
    },
    { timezone: config.timezone },
  );

  tasks.set(storeId, task);
}

/** Load all schedules at boot. */
export function initScheduler(): void {
  for (const s of Schedules.all()) reschedule(s.store_id);
  log.info(`Scheduler initialised (${tasks.size} active schedule(s), timezone ${config.timezone})`);
}
