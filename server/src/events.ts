import { EventEmitter } from 'node:events';

export type AppEvent =
  | { kind: 'log'; storeId: string | null; runId: string | null; ts: string; level: string; phase?: string; message: string }
  | { kind: 'progress'; storeId: string; runId: string; phase: string; step: number; totalSteps: number; label: string; determinate: boolean; current?: number; total?: number; percent?: number }
  | { kind: 'run'; storeId: string; runId: string; runType: string; status: string; backupId?: string; error?: string };

class EventHub extends EventEmitter {
  publish(event: AppEvent) {
    this.emit('event', event);
  }
  subscribe(handler: (event: AppEvent) => void): () => void {
    this.on('event', handler);
    return () => this.off('event', handler);
  }
}

// Allow many concurrent SSE listeners.
export const hub = new EventHub();
hub.setMaxListeners(1000);
