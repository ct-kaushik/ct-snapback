import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { decryptSecret } from '../crypto.js';
import { Stores, Backups, Runs } from '../db/models.js';
import { ShopifyClient } from '../shopify/client.js';
import { makeReporter, type Reporter } from './reporter.js';
import { hub } from '../events.js';
import { loadBackup, safeParse, type BackupData } from '../import/loader.js';
import { IdMap } from '../import/id-map.js';
import { isReferenceType } from '../export/schema.js';
import {
  PRODUCT_SET, METAFIELDS_SET, COLLECTION_CREATE, COLLECTION_UPDATE, COLLECTION_ADD_PRODUCTS,
  COLLECTION_BY_HANDLE, PRODUCT_BY_HANDLE, METAOBJECT_UPSERT, METAFIELD_DEFINITION_CREATE,
  METAOBJECT_DEFINITION_CREATE, METAOBJECT_DEFINITION_BY_TYPE,
  STAGED_UPLOADS_CREATE, LOCATIONS, PRODUCT_VARIANT_BY_SKU, INVENTORY_ITEM_UPDATE,
  INVENTORY_ACTIVATE, INVENTORY_SET_QUANTITIES, INVENTORY_ITEM_LEVELS, PRODUCT_VARIANTS_BY_HANDLE,
} from '../shopify/gql.js';

export interface RestoreResources {
  definitions: boolean;
  metaobjects: boolean;
  products: boolean;
  collections: boolean;
  metafields: boolean;
  inventory: boolean;
}

export type ConflictMode = 'overwrite' | 'skip';

export interface RestoreOptions {
  sourceBackupId: string;
  targetStoreId: string;
  resources: RestoreResources;
  dryRun: boolean;
  conflictMode: ConflictMode;
  userId?: string | null;
}

interface RestoreOutcome {
  failedMetafields: number;
}

export function countRestoreSteps(r: RestoreResources): number {
  // metaobjects contributes two phases: definitions + entries.
  const n = [r.definitions, r.products, r.collections, r.metafields, r.inventory].filter(Boolean).length + (r.metaobjects ? 2 : 0);
  return n || 1;
}

export async function runRestoreJob(p: RestoreOptions & { runId: string }): Promise<void> {
  const target = Stores.byId(p.targetStoreId);
  const backup = Backups.byId(p.sourceBackupId);
  if (!target) throw new Error('Target store not found');
  if (!backup) throw new Error('Source backup not found');

  const totalSteps = p.dryRun ? 1 : countRestoreSteps(p.resources);
  const reporter = makeReporter(p.runId, target.id, totalSteps);
  hub.publish({ kind: 'run', storeId: target.id, runId: p.runId, runType: 'restore', status: 'running' });

  const client = new ShopifyClient({ domain: target.domain, token: decryptSecret(target.token_enc), apiVersion: target.api_version });
  const data = loadBackup(backup.dir);

  // Same-store restore lets us reuse original GIDs (e.g. for inventory when variants have no SKU).
  let sourceDomain = Stores.byId(backup.store_id)?.domain ?? '';
  try {
    const mf = JSON.parse(fs.readFileSync(path.join(backup.dir, 'manifest.json'), 'utf8'));
    if (mf?.store?.domain) sourceDomain = mf.store.domain;
  } catch { /* no manifest (e.g. uploaded partial backup) */ }
  const sameStore = Boolean(sourceDomain) && sourceDomain === target.domain;

  try {
    reporter.log.info(`Restore ${p.dryRun ? '(dry-run) ' : ''}from backup ${backup.id} → ${target.domain}${sameStore ? ' (same store)' : ''}`);
    let outcome: RestoreOutcome = { failedMetafields: 0 };
    if (p.dryRun) {
      await dryRun(client, data, p.resources, reporter);
    } else {
      outcome = await execute(client, data, p.resources, p.conflictMode, backup.dir, sameStore, reporter);
    }
    if (outcome.failedMetafields) {
      throw new Error(`${outcome.failedMetafields} metafield${outcome.failedMetafields === 1 ? '' : 's'} could not be restored; see the run log for details.`);
    }
    Runs.finish(p.runId, 'completed');
    hub.publish({ kind: 'run', storeId: target.id, runId: p.runId, runType: 'restore', status: 'completed' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.log.error(`Restore failed: ${message}`);
    Runs.finish(p.runId, 'failed', { error: message });
    hub.publish({ kind: 'run', storeId: target.id, runId: p.runId, runType: 'restore', status: 'failed', error: message });
    throw err;
  }
}

// ---------- Dry-run: classify create vs update, no writes ----------
async function dryRun(client: ShopifyClient, data: BackupData, res: RestoreResources, reporter: Reporter) {
  reporter.phase('Preview');
  let prodCreate = 0, prodUpdate = 0, colCreate = 0, colUpdate = 0;

  if (res.products) {
    for (let i = 0; i < data.products.length; i++) {
      reporter.determinate(i, data.products.length, 'Previewing products');
      const exists = await existsByHandle(client, PRODUCT_BY_HANDLE, 'productByHandle', data.products[i].handle);
      exists ? prodUpdate++ : prodCreate++;
    }
  }
  if (res.collections) {
    for (let i = 0; i < data.collections.length; i++) {
      reporter.determinate(i, data.collections.length, 'Previewing collections');
      const exists = await existsByHandle(client, COLLECTION_BY_HANDLE, 'collectionByHandle', data.collections[i].handle);
      exists ? colUpdate++ : colCreate++;
    }
  }

  reporter.log.info(
    `DRY-RUN SUMMARY — products: ${prodCreate} create / ${prodUpdate} update; ` +
    `collections: ${colCreate} create / ${colUpdate} update; ` +
    `metafields: ${res.metafields ? data.metafields.length : 0}; ` +
    `metaobjects: ${res.metaobjects ? data.metaobjects.length : 0}; ` +
    `definitions: ${res.definitions ? data.defs.length : 0}. No changes were written.`,
    'Preview',
  );
}

// ---------- Execute ----------
async function execute(client: ShopifyClient, data: BackupData, res: RestoreResources, conflict: ConflictMode, backupDir: string, sameStore: boolean, reporter: Reporter): Promise<RestoreOutcome> {
  const idMap = new IdMap();
  const productHandleToGid = new Map<string, string>();
  const collectionHandleToGid = new Map<string, string>();
  const variantKeyToGid = new Map<string, string>();
  const skippedProducts = new Set<string>();
  const skippedCollections = new Set<string>();
  const metaobjectDefMap = new Map<string, string>(); // old MetaobjectDefinition GID -> new
  let failedMetafields = 0;

  // Metaobject definitions must exist before both metafield definitions (which reference them)
  // and metaobject entries (which need their type).
  if (res.metaobjects) {
    reporter.phase('Metaobject definitions');
    await restoreMetaobjectDefinitions(client, data, metaobjectDefMap, reporter);
  }

  if (res.definitions) {
    reporter.phase('Metafield definitions');
    await restoreDefinitions(client, data, metaobjectDefMap, reporter);
  }

  if (res.metaobjects) {
    reporter.phase('Metaobjects');
    await restoreMetaobjects(client, data, idMap, reporter);
  }

  if (res.products) {
    reporter.phase('Products');
    await restoreProducts(client, data, idMap, productHandleToGid, variantKeyToGid, conflict, skippedProducts, backupDir, reporter);
  }

  if (res.collections) {
    reporter.phase('Collections');
    await restoreCollections(client, data, idMap, collectionHandleToGid, productHandleToGid, conflict, skippedCollections, backupDir, reporter);
  }

  if (res.metafields) {
    reporter.phase('Metafields');
    failedMetafields = await restoreMetafields(client, data, idMap, { productHandleToGid, collectionHandleToGid, variantKeyToGid, skippedProducts, skippedCollections }, reporter);
  }

  if (res.inventory) {
    reporter.phase('Inventory');
    await restoreInventory(client, data, sameStore, reporter);
  }

  return { failedMetafields };
}

/** Normalize a variant's option values to a comparable key, e.g. [{name:"Size",value:"M"}] -> "size=m|". */
function optionKey(opts: Array<{ name: string; value: string }>): string {
  return [...(opts ?? [])]
    .map((o) => `${(o.name ?? '').toLowerCase()}=${(o.value ?? '').toLowerCase()}`)
    .sort()
    .join('|');
}

/** Read an inventoryItem's current on_hand per location name. */
function levelsToMap(inventoryItem: any): Map<string, number> {
  const m = new Map<string, number>();
  for (const lvl of inventoryItem?.inventoryLevels?.nodes ?? []) {
    const oh = ((lvl.quantities ?? []).find((q: any) => q.name === 'on_hand')?.quantity) ?? 0;
    if (lvl.location?.name) m.set(lvl.location.name, oh);
  }
  return m;
}

/**
 * Restore per-location on_hand quantities. Resolves the target variant by (in order):
 * the original inventory-item GID (same store), SKU, or product handle + option values (no SKU needed).
 * Locations are matched by name (cross-store safe).
 */
async function restoreInventory(client: ShopifyClient, data: BackupData, sameStore: boolean, reporter: Reporter) {
  if (!data.inventoryLevels.length) { reporter.log.info('No inventory levels in this backup.', 'Inventory'); return; }

  // Target location name -> id map.
  const locMap = new Map<string, string>();
  let after: string | null = null;
  do {
    const r = await client.graphql<any>(LOCATIONS, { after });
    const d: any = r.data;
    for (const e of d.locations.edges) locMap.set(e.node.name, e.node.id);
    after = d.locations.pageInfo.hasNextPage ? d.locations.pageInfo.endCursor : null;
  } while (after);

  // Group rows by the source variant. variant_id is present for a same-store backup, but for
  // products added/edited offline it's blank — so fall back to a SKU or handle+options key so
  // those rows still resolve (via the SKU / option matching below) instead of being dropped.
  const byVariant = new Map<string, Record<string, string>[]>();
  for (const r of data.inventoryLevels) {
    const key = r.variant_id
      || (r.variant_sku ? `sku:${r.variant_sku}` : '')
      || (r.product_handle ? `handle:${r.product_handle}|${optionKey(safeParse<any[]>(r.option_values, []))}` : '');
    if (!key) continue;
    const arr = byVariant.get(key) ?? [];
    arr.push(r);
    byVariant.set(key, arr);
  }
  const setInputs: Array<{ inventoryItemId: string; locationId: string; quantity: number; changeFromQuantity: number }> = [];
  const productVariantCache = new Map<string, any>(); // handle -> variants[] (avoids refetching per variant)
  let items = 0, unresolved = 0, unmatchedLoc = 0;
  const via = { gid: 0, sku: 0, options: 0 };

  const variantIds = [...byVariant.keys()];
  for (let i = 0; i < variantIds.length; i++) {
    reporter.determinate(i, variantIds.length);
    const rows = byVariant.get(variantIds[i])!;
    const first = rows[0];
    try {
      let invItemId: string | undefined;
      let currentByLoc = new Map<string, number>();

      // 1) Same store: the original inventory item GID is still valid.
      if (sameStore && first.inventory_item_id) {
        const { data: r } = await client.graphql<any>(INVENTORY_ITEM_LEVELS, { id: first.inventory_item_id });
        if (r.inventoryItem?.id) { invItemId = r.inventoryItem.id; currentByLoc = levelsToMap(r.inventoryItem); via.gid++; }
      }
      // 2) By SKU.
      if (!invItemId && first.variant_sku) {
        const { data: v } = await client.graphql<any>(PRODUCT_VARIANT_BY_SKU, { q: `sku:${JSON.stringify(first.variant_sku)}` });
        const node = v.productVariants?.nodes?.[0];
        if (node?.inventoryItem?.id) { invItemId = node.inventoryItem.id; currentByLoc = levelsToMap(node.inventoryItem); via.sku++; }
      }
      // 3) By product handle + option values (works with no SKU/barcode).
      if (!invItemId && first.product_handle) {
        let variants = productVariantCache.get(first.product_handle);
        if (!variants) {
          const { data: p } = await client.graphql<any>(PRODUCT_VARIANTS_BY_HANDLE, { handle: first.product_handle });
          variants = p.productByHandle?.variants?.nodes ?? [];
          productVariantCache.set(first.product_handle, variants);
        }
        const wantKey = optionKey(safeParse<any[]>(first.option_values, []));
        const match = variants.find((v: any) => optionKey(v.selectedOptions) === wantKey)
          ?? (variants.length === 1 ? variants[0] : undefined);
        if (match?.inventoryItem?.id) { invItemId = match.inventoryItem.id; currentByLoc = levelsToMap(match.inventoryItem); via.options++; }
      }

      if (!invItemId) { unresolved++; continue; }
      items++;
      await client.graphql(INVENTORY_ITEM_UPDATE, { id: invItemId, input: { tracked: true } }).catch(() => {});
      for (const r of rows) {
        const locationId = locMap.get(r.location_name);
        if (!locationId) { unmatchedLoc++; continue; }
        await client.graphql(INVENTORY_ACTIVATE, { inventoryItemId: invItemId, locationId, key: randomUUID() }).catch(() => {});
        const onHand = Number(r.on_hand);
        if (Number.isFinite(onHand)) setInputs.push({ inventoryItemId: invItemId, locationId, quantity: onHand, changeFromQuantity: currentByLoc.get(r.location_name) ?? 0 });
      }
    } catch (err) {
      reporter.log.warn(`Inventory for variant ${first.variant_sku || first.product_handle || variantIds[i]}: ${(err as Error).message}`, 'Inventory');
    }
  }

  // Batch the on_hand sets. Each quantity carries changeFromQuantity (the current on_hand baseline this schema requires).
  for (let i = 0; i < setInputs.length; i += 200) {
    const batch = setInputs.slice(i, i + 200);
    try {
      await client.graphql(INVENTORY_SET_QUANTITIES, {
        input: { name: 'on_hand', reason: 'correction', quantities: batch },
        key: randomUUID(),
      });
    } catch (err) {
      reporter.log.warn(`inventorySetQuantities batch failed: ${(err as Error).message}`, 'Inventory');
    }
  }
  reporter.determinate(variantIds.length, variantIds.length);
  reporter.log.info(`Inventory — variants matched: ${items} (via GID ${via.gid}, SKU ${via.sku}, options ${via.options}), quantities set: ${setInputs.length}, unresolved variants: ${unresolved}, unmatched locations: ${unmatchedLoc}`, 'Inventory');
}

async function mutate(
  client: ShopifyClient,
  query: string,
  vars: Record<string, unknown>,
  rootField: string,
  reporter: Reporter,
  phase: string,
  logUserErrors = true,
): Promise<any | null> {
  const { data, cost } = await client.graphql(query, vars);
  await client.paceAfter(cost);
  const payload = data[rootField];
  const errors = payload?.userErrors ?? [];
  if (errors.length && logUserErrors) {
    reporter.log.warn(`${rootField}: ${errors.map((e: any) => `${(e.field ?? []).join('.')} ${e.message}`).join('; ')}`, phase);
  }
  return payload;
}

async function existsByHandle(client: ShopifyClient, query: string, rootField: string, handle: string): Promise<boolean> {
  try {
    const { data } = await client.graphql(query, { handle });
    return Boolean(data[rootField]);
  } catch {
    return false;
  }
}

/** Shopify- and app-owned namespaces can't be created by a general token — skip them. */
function isReservedNamespace(ns: string): boolean {
  return ns === 'shopify' || ns.startsWith('shopify--') || ns.startsWith('app--') || ns.startsWith('$app');
}

/** Remap metaobject-definition GID references inside a validations array to the target store's new GIDs. */
function remapDefValidations(validations: any[], defMap: Map<string, string>): Array<{ name: string; value: string }> {
  return (validations ?? []).map((v) => {
    if (v?.name === 'metaobject_definition_id' && typeof v.value === 'string') {
      return { name: v.name, value: defMap.get(v.value) ?? v.value };
    }
    if (v?.name === 'metaobject_definition_ids' && typeof v.value === 'string') {
      try {
        const arr = JSON.parse(v.value);
        if (Array.isArray(arr)) return { name: v.name, value: JSON.stringify(arr.map((g: string) => defMap.get(g) ?? g)) };
      } catch { /* keep as-is */ }
    }
    return { name: v.name, value: v.value };
  });
}

/** Create metaobject definitions first, recording old→new GIDs so metafield definitions can reference them.
 *  Cross-references between metaobject definitions are relaxed (stripped) to avoid create-order failures. */
async function restoreMetaobjectDefinitions(client: ShopifyClient, data: BackupData, defMap: Map<string, string>, reporter: Reporter) {
  let created = 0, existing = 0, failed = 0, skipped = 0;
  for (let i = 0; i < data.metaobjectDefs.length; i++) {
    reporter.determinate(i, data.metaobjectDefs.length);
    const d = data.metaobjectDefs[i];
    if (d.type && (d.type.startsWith('shopify--') || d.type.startsWith('app--'))) { skipped++; continue; }
    const fieldDefs = safeParse<any[]>(d.field_definitions_json, []).map((fd) => ({
      key: fd.key,
      name: fd.name || fd.key,
      type: fd.type?.name ?? fd.type,
      description: fd.description || undefined,
      required: fd.required ?? undefined,
      // Drop metaobject-definition cross-references so creation never depends on another def existing yet.
      validations: (fd.validations ?? []).filter((v: any) => v?.name !== 'metaobject_definition_id' && v?.name !== 'metaobject_definition_ids').map((v: any) => ({ name: v.name, value: v.value })),
    }));
    const caps = safeParse<any>(d.capabilities_json, {});
    const definition: any = { type: d.type, name: d.name || d.type, fieldDefinitions: fieldDefs };
    if (d.display_name_key) definition.displayNameKey = d.display_name_key;
    if (caps?.publishable?.enabled) definition.capabilities = { publishable: { enabled: true } };
    try {
      const { data: res } = await client.graphql<any>(METAOBJECT_DEFINITION_CREATE, { definition });
      const payload = res.metaobjectDefinitionCreate;
      const errs = payload?.userErrors ?? [];
      const newId = payload?.metaobjectDefinition?.id;
      if (newId) { created++; if (d.id) defMap.set(d.id, newId); }
      else if (errs.some((e: any) => e.code === 'TAKEN' || /taken|already/i.test(e.message ?? ''))) {
        existing++;
        const cur = await client.graphql<any>(METAOBJECT_DEFINITION_BY_TYPE, { type: d.type }).catch(() => null);
        const curId = cur?.data?.metaobjectDefinitionByType?.id;
        if (d.id && curId) defMap.set(d.id, curId);
      } else if (errs.length) {
        failed++;
        reporter.log.warn(`Metaobject definition ${d.type}: ${errs.map((e: any) => e.message).join('; ')}`, 'Metaobject definitions');
      }
    } catch (err) {
      failed++;
      reporter.log.debug(`Metaobject definition ${d.type} skipped: ${(err as Error).message}`, 'Metaobject definitions');
    }
  }
  reporter.log.info(`Metaobject definitions — created: ${created}, already existed: ${existing}, failed: ${failed}, skipped (reserved): ${skipped}`, 'Metaobject definitions');
}

async function restoreDefinitions(client: ShopifyClient, data: BackupData, defMap: Map<string, string>, reporter: Reporter) {
  let created = 0, existing = 0, failed = 0, skipped = 0;
  for (let i = 0; i < data.defs.length; i++) {
    reporter.determinate(i, data.defs.length);
    const d = data.defs[i];
    // Shopify/app-owned definitions are managed by Shopify and can't be created via the API.
    if (isReservedNamespace(d.namespace)) { skipped++; continue; }
    const definition = {
      name: d.name,
      namespace: d.namespace,
      key: d.key,
      description: d.description || undefined,
      type: d.type,
      ownerType: d.owner_type,
      // Remap any metaobject-definition references to the target store's new GIDs (created above).
      validations: remapDefValidations(safeParse<any[]>(d.validations_json, []), defMap),
    };
    try {
      const { data: res } = await client.graphql<any>(METAFIELD_DEFINITION_CREATE, { definition });
      const errs = res.metafieldDefinitionCreate?.userErrors ?? [];
      const alreadyExists = errs.some((e: any) => e.code === 'TAKEN' || /in use/i.test(e.message ?? ''));
      if (alreadyExists) existing++;
      else if (errs.length) { failed++; reporter.log.warn(`Definition ${d.owner_type} ${d.namespace}.${d.key}: ${errs.map((e: any) => e.message).join('; ')}`, 'Metafield definitions'); }
      else created++;
    } catch (err) {
      failed++;
      reporter.log.debug(`Definition ${d.namespace}.${d.key} skipped: ${(err as Error).message}`, 'Metafield definitions');
    }
  }
  reporter.log.info(`Metafield definitions — created: ${created}, already existed: ${existing}, failed: ${failed}, skipped (reserved): ${skipped}`, 'Metafield definitions');
}

async function restoreMetaobjects(client: ShopifyClient, data: BackupData, idMap: IdMap, reporter: Reporter) {
  for (let i = 0; i < data.metaobjects.length; i++) {
    reporter.determinate(i, data.metaobjects.length);
    const m = data.metaobjects[i];
    const fields = safeParse<any[]>(m.fields_json, []).map((f) => ({ key: f.key, value: f.value ?? '' }));
    try {
      const payload = await mutate(
        client,
        METAOBJECT_UPSERT,
        { handle: { type: m.type, handle: m.handle }, metaobject: { fields } },
        'metaobjectUpsert',
        reporter,
        'Metaobjects',
      );
      const newId = payload?.metaobject?.id;
      if (m.id && newId) idMap.set(m.id, newId);
    } catch (err) {
      reporter.log.warn(`Metaobject ${m.type}/${m.handle}: ${(err as Error).message}`, 'Metaobjects');
    }
  }
}

async function restoreProducts(
  client: ShopifyClient, data: BackupData, idMap: IdMap,
  productHandleToGid: Map<string, string>, variantKeyToGid: Map<string, string>,
  conflict: ConflictMode, skipped: Set<string>, backupDir: string, reporter: Reporter,
) {
  const variantsByProduct = groupBy(data.variants, 'product_handle');
  const imagesByProduct = groupBy(data.images, 'product_handle');
  let created = 0, updated = 0, skippedCount = 0;

  for (let i = 0; i < data.products.length; i++) {
    reporter.determinate(i, data.products.length);
    const prod = data.products[i];
    const handle = prod.handle;
    const options = safeParse<any[]>(prod.options_json, []);
    const variants = (variantsByProduct.get(handle) ?? []).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
    const images = imagesByProduct.get(handle) ?? [];

    // Match an existing product by handle so productSet UPDATES instead of failing on a taken handle.
    const existingId = await getGidByHandle(client, PRODUCT_BY_HANDLE, 'productByHandle', handle);
    if (existingId && conflict === 'skip') {
      skipped.add(handle);
      productHandleToGid.set(handle, existingId);
      skippedCount++;
      continue;
    }

    const files = await buildFiles(client, images, backupDir, handle, reporter);

    const input: Record<string, unknown> = {
      handle,
      title: prod.title,
      descriptionHtml: prod.description_html || '',
      vendor: prod.vendor || undefined,
      productType: prod.product_type || undefined,
      status: (prod.status || 'ACTIVE').toUpperCase(),
      tags: safeParse<string[]>(prod.tags, []),
      seo: { title: prod.seo_title || undefined, description: prod.seo_description || undefined },
      templateSuffix: prod.template_suffix || undefined,
      category: prod.category_id || undefined,
      productOptions: options.map((o) => ({ name: o.name, values: (o.values ?? []).map((v: string) => ({ name: v })) })),
      files,
      variants: variants.map((v) => ({
        optionValues: safeParse<any[]>(v.option_values_json, []).map((so) => ({ optionName: so.name, name: so.value })),
        price: v.price || undefined,
        compareAtPrice: v.compare_at_price || undefined,
        barcode: v.barcode || undefined,
        taxable: v.taxable === 'true' || v.taxable === '1' ? true : v.taxable === 'false' ? false : undefined,
        inventoryItem: {
          sku: v.sku || undefined,
          cost: v.cost || undefined,
          measurement: v.weight_value ? { weight: { value: Number(v.weight_value), unit: v.weight_unit || 'GRAMS' } } : undefined,
        },
      })),
    };

    if (existingId) input.id = existingId; // update in place (replace-all semantics)

    try {
      let res = await runMutation(client, PRODUCT_SET, { input }, 'productSet');
      // If media (a dead source URL from an old backup) blocked the product, retry without images.
      if (!res.ok && Array.isArray(input.files) && (input.files as any[]).length && /image|media|file/i.test(res.message)) {
        reporter.log.warn(`Product ${handle}: media could not be attached (${res.message}); creating without images`, 'Products');
        delete input.files;
        res = await runMutation(client, PRODUCT_SET, { input }, 'productSet');
      }
      if (res.ok && res.id) {
        existingId ? updated++ : created++;
        productHandleToGid.set(handle, res.id);
        if (prod.id) idMap.set(prod.id, res.id);
        // Map variants by SKU.
        const respVariants: Array<{ id: string; sku: string }> = res.raw?.product?.variants?.nodes ?? [];
        for (const rv of respVariants) {
          const srcVariant = variants.find((v) => (v.sku || '') === (rv.sku || ''));
          if (srcVariant) {
            variantKeyToGid.set(`${handle}::${srcVariant.sku || ''}`, rv.id);
            if (srcVariant.id) idMap.set(srcVariant.id, rv.id);
          }
        }
      } else if (res.message) {
        reporter.log.warn(`Product ${handle}: ${res.message}`, 'Products');
      }
    } catch (err) {
      reporter.log.warn(`Product ${handle}: ${(err as Error).message}`, 'Products');
    }
  }
  reporter.log.info(`Products — created: ${created}, updated: ${updated}, skipped: ${skippedCount}`, 'Products');
}

async function restoreCollections(
  client: ShopifyClient, data: BackupData, idMap: IdMap,
  collectionHandleToGid: Map<string, string>, productHandleToGid: Map<string, string>,
  conflict: ConflictMode, skipped: Set<string>, backupDir: string, reporter: Reporter,
) {
  const membersByCollection = groupBy(data.collectionProducts, 'collection_handle');
  let created = 0, updated = 0, skippedCount = 0;

  for (let i = 0; i < data.collections.length; i++) {
    reporter.determinate(i, data.collections.length);
    const c = data.collections[i];
    const existingGid = await getGidByHandle(client, COLLECTION_BY_HANDLE, 'collectionByHandle', c.handle);

    if (existingGid && conflict === 'skip') {
      skipped.add(c.handle);
      collectionHandleToGid.set(c.handle, existingGid);
      skippedCount++;
      continue;
    }

    const members = membersByCollection.get(c.handle) ?? [];
    const productGids = members
      .map((m) => productHandleToGid.get(m.product_handle))
      .filter((g): g is string => Boolean(g));

    const input: Record<string, unknown> = {
      handle: c.handle,
      title: c.title,
      descriptionHtml: c.description_html || '',
      templateSuffix: c.template_suffix || undefined,
      seo: { title: c.seo_title || undefined, description: c.seo_description || undefined },
      sortOrder: c.sort_order || undefined,
    };
    // Smart collection: membership is rule-derived — set the ruleSet and do NOT send products.
    const rules = safeParse<any[]>(c.rules_json, []);
    if (rules.length) {
      input.ruleSet = {
        appliedDisjunctively: c.applied_disjunctively === 'true',
        rules: rules.map((r) => ({ column: r.column, relation: r.relation, condition: r.condition })),
      };
    } else if (productGids.length && !existingGid) {
      // 'products' is only accepted on collectionCreate. For updates we add members separately (below).
      input.products = productGids;
    }
    if (existingGid) input.id = existingGid;

    // Prefer the stored image binary (survives a wipe); fall back to the original URL.
    const imageSrc = await resolveCollectionImageSrc(client, c, backupDir, reporter);
    if (imageSrc) input.image = { src: imageSrc, altText: c.image_alt || undefined };

    const field = existingGid ? 'collectionUpdate' : 'collectionCreate';
    const query = existingGid ? COLLECTION_UPDATE : COLLECTION_CREATE;
    try {
      let payload = await runMutation(client, query, { input }, field);
      // If the image blocked creation, retry once without it so the collection still gets created.
      if (!payload.ok && input.image && /image/i.test(payload.message)) {
        reporter.log.warn(`Collection ${c.handle}: image could not be attached (${payload.message}); creating without image`, 'Collections');
        delete input.image;
        payload = await runMutation(client, query, { input }, field);
      }
      if (payload.ok && payload.id) {
        existingGid ? updated++ : created++;
        collectionHandleToGid.set(c.handle, payload.id);
        if (c.id) idMap.set(c.id, payload.id);
        // Existing manual collection: membership couldn't go through the update input — add it now.
        if (existingGid && !rules.length && productGids.length) {
          const add = await runMutation(client, COLLECTION_ADD_PRODUCTS, { id: payload.id, productIds: productGids }, 'collectionAddProducts');
          if (!add.ok && add.message) reporter.log.warn(`Collection ${c.handle}: adding products — ${add.message}`, 'Collections');
        }
      } else if (payload.message) {
        reporter.log.warn(`Collection ${c.handle}: ${payload.message}`, 'Collections');
      }
    } catch (err) {
      reporter.log.warn(`Collection ${c.handle}: ${(err as Error).message}`, 'Collections');
    }
  }
  reporter.log.info(`Collections — created: ${created}, updated: ${updated}, skipped: ${skippedCount}`, 'Collections');
}

async function restoreMetafields(
  client: ShopifyClient, data: BackupData, idMap: IdMap,
  maps: {
    productHandleToGid: Map<string, string>; collectionHandleToGid: Map<string, string>; variantKeyToGid: Map<string, string>;
    skippedProducts: Set<string>; skippedCollections: Set<string>;
  },
  reporter: Reporter,
): Promise<number> {
  // Build owner id for each metafield row; skip when the owner couldn't be resolved
  // or when its parent product/collection was intentionally skipped.
  const inputs: Array<{ ownerId: string; namespace: string; key: string; type: string; value: string }> = [];
  let skipped = 0;

  for (const mf of data.metafields) {
    let ownerId: string | undefined;
    if (mf.owner_type === 'PRODUCT') {
      if (maps.skippedProducts.has(mf.owner_key)) { skipped++; continue; }
      ownerId = maps.productHandleToGid.get(mf.owner_key) ?? (await getGidByHandle(client, PRODUCT_BY_HANDLE, 'productByHandle', mf.owner_key)) ?? undefined;
    } else if (mf.owner_type === 'COLLECTION') {
      if (maps.skippedCollections.has(mf.owner_key)) { skipped++; continue; }
      ownerId = maps.collectionHandleToGid.get(mf.owner_key) ?? (await getGidByHandle(client, COLLECTION_BY_HANDLE, 'collectionByHandle', mf.owner_key)) ?? undefined;
    } else if (mf.owner_type === 'PRODUCTVARIANT') {
      const parentHandle = mf.owner_key.split('::')[0];
      if (maps.skippedProducts.has(parentHandle)) { skipped++; continue; }
      ownerId = maps.variantKeyToGid.get(mf.owner_key);
    }
    if (!ownerId) {
      skipped++;
      continue;
    }
    const value = isReferenceType(mf.type) ? idMap.remapValue(mf.type, mf.value) : mf.value;
    inputs.push({ ownerId, namespace: mf.namespace, key: mf.key, type: mf.type, value });
  }

  let written = 0;
  let failed = 0;
  for (let i = 0; i < inputs.length; i += 25) {
    reporter.determinate(i, inputs.length);
    const batch = inputs.slice(i, i + 25);
    const result = await setMetafieldsWithFallback(client, batch, reporter);
    written += result.written;
    failed += result.failed;
  }
  reporter.determinate(inputs.length, inputs.length);
  reporter.log.info(`Metafields — written: ${written}, failed: ${failed}, skipped (owner unresolved): ${skipped}, unresolved references: ${idMap.unresolved}`, 'Metafields');
  return failed;
}

type MetafieldSetInput = { ownerId: string; namespace: string; key: string; type: string; value: string };

interface MetafieldSetResult {
  written: number;
  failed: number;
}

/**
 * Shopify applies metafieldsSet atomically. If a batch has user errors, retry each value so
 * valid metafields are not lost alongside the invalid one(s).
 */
async function setMetafieldsWithFallback(client: ShopifyClient, batch: MetafieldSetInput[], reporter: Reporter): Promise<MetafieldSetResult> {
  try {
    const payload = await mutate(client, METAFIELDS_SET, { metafields: batch }, 'metafieldsSet', reporter, 'Metafields', false);
    const errors = payload?.userErrors ?? [];
    if (!errors.length) return { written: batch.length, failed: 0 };

    if (batch.length === 1) {
      const metafield = batch[0];
      reporter.log.warn(
        `Metafield ${metafield.ownerId} ${metafield.namespace}.${metafield.key}: ${formatUserErrors(errors)}`,
        'Metafields',
      );
      return { written: 0, failed: 1 };
    }

    reporter.log.warn(`metafieldsSet batch had ${errors.length} error${errors.length === 1 ? '' : 's'}; retrying ${batch.length} values individually.`, 'Metafields');
  } catch (err) {
    if (batch.length === 1) {
      const metafield = batch[0];
      reporter.log.warn(`Metafield ${metafield.ownerId} ${metafield.namespace}.${metafield.key}: ${(err as Error).message}`, 'Metafields');
      return { written: 0, failed: 1 };
    }
    reporter.log.warn(`metafieldsSet batch request failed: ${(err as Error).message}; retrying ${batch.length} values individually.`, 'Metafields');
  }

  let written = 0;
  let failed = 0;
  for (const metafield of batch) {
    const result = await setMetafieldsWithFallback(client, [metafield], reporter);
    written += result.written;
    failed += result.failed;
  }
  return { written, failed };
}

function formatUserErrors(errors: Array<{ field?: string[]; message?: string }>): string {
  return errors.map((error) => `${(error.field ?? []).join('.')} ${error.message ?? 'Unknown Shopify error'}`.trim()).join('; ');
}

/** Build the productSet `files` array: upload each stored image binary via staged uploads,
 *  falling back to the original URL only if the binary is missing. */
async function buildFiles(
  client: ShopifyClient, images: Record<string, string>[], backupDir: string, handle: string, reporter: Reporter,
): Promise<Array<{ originalSource: string; alt?: string; contentType: string }>> {
  const files: Array<{ originalSource: string; alt?: string; contentType: string }> = [];
  for (const img of images) {
    let originalSource = img.src || '';
    const localRel = img.file;
    if (localRel) {
      const localPath = path.join(backupDir, localRel);
      if (fs.existsSync(localPath)) {
        try {
          originalSource = await uploadLocalImage(client, localPath, img.filename || path.basename(localPath));
        } catch (err) {
          reporter.log.warn(`Image upload failed for ${handle} (${img.filename}); falling back to URL: ${(err as Error).message}`, 'Products');
        }
      }
    }
    if (originalSource) files.push({ originalSource, alt: img.alt || undefined, contentType: 'IMAGE' });
  }
  return files;
}

/** Upload a local image to Shopify via staged uploads; returns the resourceUrl for productSet. */
async function uploadLocalImage(client: ShopifyClient, filePath: string, filename: string): Promise<string> {
  const mimeType = mimeFromName(filename);
  const { data } = await client.graphql<any>(STAGED_UPLOADS_CREATE, {
    input: [{ filename, mimeType, resource: 'IMAGE', httpMethod: 'POST' }],
  });
  const errs = data.stagedUploadsCreate?.userErrors ?? [];
  const target = data.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target || errs.length) throw new Error(errs.map((e: any) => e.message).join('; ') || 'no staged target returned');

  const form = new FormData();
  for (const p of target.parameters as Array<{ name: string; value: string }>) form.append(p.name, p.value);
  const buf = fs.readFileSync(filePath);
  form.append('file', new Blob([buf], { type: mimeType }), filename);

  const up = await fetch(target.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`staged upload HTTP ${up.status}`);
  return target.resourceUrl as string;
}

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const map: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml' };
  return map[ext] ?? 'image/jpeg';
}

/** Run a create/update mutation and return a normalized result (ok + id + joined error message + raw payload). */
async function runMutation(client: ShopifyClient, query: string, vars: Record<string, unknown>, rootField: string): Promise<{ ok: boolean; id?: string; message: string; raw: any }> {
  const { data, cost } = await client.graphql<any>(query, vars);
  await client.paceAfter(cost);
  const payload = data[rootField];
  const errs = payload?.userErrors ?? [];
  const id = payload?.collection?.id ?? payload?.product?.id ?? undefined;
  return { ok: errs.length === 0, id, message: errs.map((e: any) => e.message).join('; '), raw: payload };
}

/** Return the image src to use for a collection: staged-uploaded local binary, or the original URL. */
async function resolveCollectionImageSrc(client: ShopifyClient, c: Record<string, string>, backupDir: string, reporter: Reporter): Promise<string | null> {
  const localRel = c.image_file;
  if (localRel) {
    const localPath = path.join(backupDir, localRel);
    if (fs.existsSync(localPath)) {
      try {
        return await uploadLocalImage(client, localPath, c.image_filename || path.basename(localPath));
      } catch (err) {
        reporter.log.warn(`Collection image upload failed for ${c.handle}; falling back to URL: ${(err as Error).message}`, 'Collections');
      }
    }
  }
  return c.image_src || null;
}

async function getGidByHandle(client: ShopifyClient, query: string, rootField: string, handle: string): Promise<string | null> {
  try {
    const { data } = await client.graphql(query, { handle });
    return data[rootField]?.id ?? null;
  } catch {
    return null;
  }
}

function groupBy(rows: Record<string, string>[], key: string): Map<string, Record<string, string>[]> {
  const map = new Map<string, Record<string, string>[]>();
  for (const r of rows) {
    const k = r[key];
    (map.get(k) ?? map.set(k, []).get(k)!).push(r);
  }
  return map;
}
