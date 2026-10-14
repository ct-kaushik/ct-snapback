import { useEffect, useRef } from 'react';

export interface SessionInfo {
  user: { id: string; email: string; name: string; role: 'admin' | 'operator' | 'viewer' } | null;
  setupRequired: boolean;
  driveEnabled: boolean;
  smtpConfigured: boolean;
}

export interface Store {
  id: string;
  name: string;
  domain: string;
  apiVersion: string;
  tokenMasked: string;
  schedule: { cron: string; enabled: boolean };
  drive: { accountId: string | null; folderId: string | null; folderName: string | null };
  lastRun: { id: string; type: string; status: string; startedAt: string } | null;
  busy: boolean;
}

export interface Backup {
  id: string;
  storeId: string;
  createdAt: string;
  status: string;
  sizeBytes: number;
  counts: Record<string, number>;
  checksumOk: boolean;
  driveStatus: string;
  driveFileId: string | null;
  runId: string | null;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'include',
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

export type AppEvent =
  | { kind: 'log'; storeId: string | null; runId: string | null; ts: string; level: string; phase?: string; message: string }
  | { kind: 'progress'; storeId: string; runId: string; phase: string; step: number; totalSteps: number; label: string; determinate: boolean; current?: number; total?: number; percent?: number }
  | { kind: 'run'; storeId: string; runId: string; runType: string; status: string; backupId?: string; error?: string };

/** Subscribe to the server-sent event stream, optionally filtered to one store. */
export function useEventStream(onEvent: (ev: AppEvent) => void, storeId?: string) {
  const cb = useRef(onEvent);
  cb.current = onEvent;
  useEffect(() => {
    const url = storeId ? `/api/events?storeId=${encodeURIComponent(storeId)}` : '/api/events';
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (e) => {
      try {
        cb.current(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
    return () => es.close();
  }, [storeId]);
}

export function fmtBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
