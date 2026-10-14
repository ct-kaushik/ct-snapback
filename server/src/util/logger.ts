import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { db, nowIso } from '../db/index.js';
import { hub } from '../events.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

// Lazily prepared so this module can be imported before migrate() creates the table.
let _insertLog: ReturnType<typeof db.prepare> | null = null;
function insertLogStmt() {
  if (!_insertLog) {
    _insertLog = db.prepare(
      `INSERT INTO logs (run_id, store_id, ts, level, phase, message, context_json)
       VALUES (@run_id, @store_id, @ts, @level, @phase, @message, @context_json)`,
    );
  }
  return _insertLog;
}

// Redact obvious secrets before anything is persisted or streamed.
function redact(s: string): string {
  return s
    .replace(/shpat_[A-Za-z0-9]+/g, 'shpat_***')
    .replace(/(access_token"?\s*[:=]\s*"?)[^"\s,}]+/gi, '$1***');
}

function write(level: Level, message: string, opts: { runId?: string | null; storeId?: string | null; phase?: string; context?: unknown } = {}) {
  const ts = nowIso();
  const msg = redact(message);
  const runId = opts.runId ?? null;
  const storeId = opts.storeId ?? null;

  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`[${ts}] ${level.toUpperCase()} ${opts.phase ? `(${opts.phase}) ` : ''}${msg}`);

  try {
    insertLogStmt().run({
      run_id: runId,
      store_id: storeId,
      ts,
      level,
      phase: opts.phase ?? null,
      message: msg,
      context_json: opts.context ? JSON.stringify(opts.context) : null,
    });
  } catch {
    /* table may not exist yet during very early boot */
  }

  if (runId) {
    try {
      const file = path.join(config.logsDir, `${runId}.log`);
      fs.appendFileSync(file, `${JSON.stringify({ ts, level, phase: opts.phase, message: msg })}\n`);
    } catch {
      /* ignore file errors */
    }
  }

  hub.publish({ kind: 'log', storeId, runId, ts, level, phase: opts.phase, message: msg });
}

/** Application-level logger (no run context). */
export const log = {
  debug: (m: string, ctx?: unknown) => write('debug', m, { context: ctx }),
  info: (m: string, ctx?: unknown) => write('info', m, { context: ctx }),
  warn: (m: string, ctx?: unknown) => write('warn', m, { context: ctx }),
  error: (m: string, ctx?: unknown) => write('error', m, { context: ctx }),
};

/** Logger bound to a specific run + store (used inside backup/restore jobs). */
export function runLogger(runId: string, storeId: string) {
  return {
    debug: (m: string, phase?: string, ctx?: unknown) => write('debug', m, { runId, storeId, phase, context: ctx }),
    info: (m: string, phase?: string, ctx?: unknown) => write('info', m, { runId, storeId, phase, context: ctx }),
    warn: (m: string, phase?: string, ctx?: unknown) => write('warn', m, { runId, storeId, phase, context: ctx }),
    error: (m: string, phase?: string, ctx?: unknown) => write('error', m, { runId, storeId, phase, context: ctx }),
  };
}

export type RunLogger = ReturnType<typeof runLogger>;
