import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  graphql: vi.fn(),
  finish: vi.fn(),
  logs: [] as Array<{ level: string; message: string; phase?: string }>,
  productInputs: [] as Array<Record<string, unknown>>,
  metafieldBatches: [] as Array<Array<Record<string, unknown>>>,
}));

vi.mock('../crypto.js', () => ({ decryptSecret: () => 'token' }));
vi.mock('../db/models.js', () => ({
  Stores: { byId: () => ({ id: 'target', domain: 'target.myshopify.com', token_enc: 'encrypted', api_version: '2026-07' }) },
  Backups: { byId: () => ({ id: 'backup', store_id: 'source', dir: '/backup' }) },
  Runs: { finish: state.finish },
}));
vi.mock('../events.js', () => ({ hub: { publish: vi.fn() } }));
vi.mock('./reporter.js', () => ({
  makeReporter: () => ({
    log: {
      info: (message: string, phase?: string) => state.logs.push({ level: 'info', message, phase }),
      warn: (message: string, phase?: string) => state.logs.push({ level: 'warn', message, phase }),
      error: (message: string, phase?: string) => state.logs.push({ level: 'error', message, phase }),
      debug: (message: string, phase?: string) => state.logs.push({ level: 'debug', message, phase }),
    },
    phase: vi.fn(),
    bulk: vi.fn(),
    determinate: vi.fn(),
  }),
}));
vi.mock('../import/loader.js', () => ({
  loadBackup: () => ({
    products: [{ id: 'source-product', handle: 'shirt', title: 'Shirt', category_id: 'gid://shopify/TaxonomyCategory/aa-1' }],
    variants: [], images: [], collections: [], collectionProducts: [], defs: [], metaobjectDefs: [], metaobjects: [], locations: [], inventoryLevels: [],
    metafields: [
      { owner_type: 'PRODUCT', owner_key: 'shirt', namespace: 'custom', key: 'working', type: 'single_line_text_field', value: 'yes' },
      { owner_type: 'PRODUCT', owner_key: 'shirt', namespace: 'shopify', key: 'color-pattern', type: 'single_line_text_field', value: 'red' },
    ],
  }),
  safeParse: <T>(_json: string | undefined, fallback: T): T => fallback,
}));
vi.mock('../shopify/client.js', () => ({
  ShopifyClient: class {
    graphql = state.graphql;
    paceAfter = vi.fn();
  },
}));

import { runRestoreJob } from './restore-job.js';

function restoreOptions() {
  return {
    sourceBackupId: 'backup',
    targetStoreId: 'target',
    runId: 'run',
    dryRun: false,
    conflictMode: 'overwrite' as const,
    resources: { definitions: false, metaobjects: false, products: true, collections: false, metafields: true, inventory: false },
  };
}

describe('runRestoreJob metafield recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.logs.length = 0;
    state.productInputs.length = 0;
    state.metafieldBatches.length = 0;
  });

  it('restores the product category, preserves valid metafields, and fails an incomplete restore', async () => {
    state.graphql.mockImplementation(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('productByHandle')) return { data: { productByHandle: null }, cost: undefined };
      if (query.includes('productSet')) {
        state.productInputs.push(variables.input as Record<string, unknown>);
        return { data: { productSet: { product: { id: 'target-product', variants: { nodes: [] } }, userErrors: [] } }, cost: undefined };
      }
      if (query.includes('metafieldsSet')) {
        const batch = variables.metafields as Array<Record<string, unknown>>;
        state.metafieldBatches.push(batch);
        if (batch.length > 1) return { data: { metafieldsSet: { userErrors: [{ field: ['metafields', '1'], message: 'Owner subtype does not match the metafield definition’s constraints.' }] } }, cost: undefined };
        return { data: { metafieldsSet: { userErrors: batch[0].key === 'color-pattern' ? [{ field: ['metafields', '0'], message: 'Owner subtype does not match the metafield definition’s constraints.' }] : [] } }, cost: undefined };
      }
      throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
    });

    await expect(runRestoreJob(restoreOptions())).rejects.toThrow('1 metafield could not be restored');

    expect(state.productInputs[0].category).toBe('gid://shopify/TaxonomyCategory/aa-1');
    expect(state.metafieldBatches).toHaveLength(3);
    expect(state.metafieldBatches[1][0].key).toBe('working');
    expect(state.metafieldBatches[2][0].key).toBe('color-pattern');
    expect(state.logs.some((entry) => entry.message.includes('Metafields — written: 1, failed: 1'))).toBe(true);
    expect(state.finish).toHaveBeenCalledWith('run', 'failed', expect.objectContaining({ error: expect.stringContaining('1 metafield') }));
  });

  it('marks the run completed when the metafield batch succeeds', async () => {
    state.graphql.mockImplementation(async (query: string, variables: Record<string, unknown>) => {
      if (query.includes('productByHandle')) return { data: { productByHandle: null }, cost: undefined };
      if (query.includes('productSet')) {
        state.productInputs.push(variables.input as Record<string, unknown>);
        return { data: { productSet: { product: { id: 'target-product', variants: { nodes: [] } }, userErrors: [] } }, cost: undefined };
      }
      if (query.includes('metafieldsSet')) {
        state.metafieldBatches.push(variables.metafields as Array<Record<string, unknown>>);
        return { data: { metafieldsSet: { userErrors: [] } }, cost: undefined };
      }
      throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
    });

    await expect(runRestoreJob(restoreOptions())).resolves.toBeUndefined();

    expect(state.metafieldBatches).toHaveLength(1);
    expect(state.logs.some((entry) => entry.message.includes('Metafields — written: 2, failed: 0'))).toBe(true);
    expect(state.finish).toHaveBeenCalledWith('run', 'completed');
  });
});
