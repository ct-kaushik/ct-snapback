import fs from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { ShopifyClient, ShopifyError } from './client.js';
import { BULK_RUN_QUERY, CURRENT_BULK_OPERATION } from './gql.js';

export interface BulkResult {
  url: string | null; // null when the query produced zero objects
  objectCount: number;
}

/**
 * Run a bulk QUERY operation to completion. Runs are sequential per store
 * (we poll currentBulkOperation, which returns the most recent QUERY op).
 */
export async function runBulkQuery(
  client: ShopifyClient,
  innerQuery: string,
  onProgress?: (objectCount: number, status: string) => void,
): Promise<BulkResult> {
  const { data } = await client.graphql(BULK_RUN_QUERY, { query: innerQuery });
  const userErrors = data.bulkOperationRunQuery?.userErrors ?? [];
  if (userErrors.length) {
    throw new ShopifyError(`Bulk query rejected: ${userErrors.map((e: any) => e.message).join('; ')}`);
  }

  // Poll until the operation finishes.
  let waited = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await sleep(2000);
    waited += 2000;
    const { data: poll } = await client.graphql(CURRENT_BULK_OPERATION);
    const op = poll.currentBulkOperation;
    if (!op) throw new ShopifyError('Bulk operation disappeared while polling');

    const count = Number(op.objectCount ?? 0);
    onProgress?.(count, op.status);

    if (op.status === 'COMPLETED') {
      return { url: op.url ?? null, objectCount: count };
    }
    if (op.status === 'FAILED' || op.status === 'CANCELED' || op.status === 'EXPIRED') {
      throw new ShopifyError(`Bulk operation ${op.status}${op.errorCode ? ` (${op.errorCode})` : ''}`);
    }
    // Safety cap: 30 minutes.
    if (waited > 30 * 60 * 1000) throw new ShopifyError('Bulk operation timed out (30m)');
  }
}

/** Stream a bulk result URL to a local .jsonl file. */
export async function downloadJsonl(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new ShopifyError(`Failed to download bulk result (HTTP ${res.status})`);
  await pipeline(Readable.fromWeb(res.body as any), fs.createWriteStream(destPath));
}
