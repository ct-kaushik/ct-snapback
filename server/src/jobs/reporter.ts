import { hub } from '../events.js';
import { runLogger, type RunLogger } from '../util/logger.js';

/**
 * Emits SSE progress events for a run. A run has N ordered phases (steps).
 * - phase(label): advance to the next step (indeterminate until made determinate).
 * - bulk(count,status): update the live object counter for a Shopify bulk phase.
 * - determinate(current,total): show a true percentage bar for the current phase.
 */
export interface Reporter {
  readonly log: RunLogger;
  phase(label: string): void;
  bulk(objectCount: number, status: string): void;
  determinate(current: number, total: number, label?: string): void;
}

export function makeReporter(runId: string, storeId: string, totalSteps: number): Reporter {
  let step = 0;
  let currentLabel = '';

  function send(partial: { determinate: boolean; current?: number; total?: number; label?: string; percent?: number }) {
    hub.publish({
      kind: 'progress',
      runId,
      storeId,
      phase: currentLabel,
      step,
      totalSteps,
      label: partial.label ?? currentLabel,
      determinate: partial.determinate,
      current: partial.current,
      total: partial.total,
      percent: partial.percent,
    });
  }

  return {
    log: runLogger(runId, storeId),
    phase(label: string) {
      step += 1;
      currentLabel = label;
      send({ determinate: false });
    },
    bulk(objectCount: number, status: string) {
      send({ determinate: false, label: `${currentLabel} — ${status} (${objectCount.toLocaleString()} objects)` });
    },
    determinate(current: number, total: number, label?: string) {
      const percent = total > 0 ? Math.round((current / total) * 100) : 0;
      send({ determinate: true, current, total, percent, label: label ?? currentLabel });
    },
  };
}
