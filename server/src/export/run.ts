import fs from 'node:fs';
import path from 'node:path';
import { dirSize, zipDir } from '../storage/local.js';
import type { ShopifyClient } from '../shopify/client.js';
import { runBulkQuery, downloadJsonl } from '../shopify/bulk.js';
import { readBulkJsonl, stitch, type JsonlNode } from '../shopify/jsonl.js';
import {
  BULK_PRODUCTS, BULK_VARIANT_METAFIELDS, BULK_COLLECTIONS,
  METAFIELD_DEFINITIONS, METAOBJECT_DEFINITIONS, METAOBJECTS_BY_TYPE,
  LOCATIONS, BULK_INVENTORY, THEMES, THEME_FILES,
} from '../shopify/gql.js';
import { writeCsv, sha256File } from './csv.js';
import { FILES, COLS, DEFINITION_OWNER_TYPES, SCHEMA_VERSION } from './schema.js';
import type { Reporter } from '../jobs/reporter.js';

export interface ExportResult {
  counts: Record<string, number>;
  sizeBytes: number;
  manifest: unknown;
  checksumOk: boolean;
}

export interface ExportStoreInfo {
  name: string;
  domain: string;
  apiVersion: string;
}

export async function runExport(client: ShopifyClient, store: ExportStoreInfo, outDir: string, reporter: Reporter): Promise<ExportResult> {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonlDir = path.join(outDir, '_raw');
  fs.mkdirSync(jsonlDir, { recursive: true });
  const imagesDir = path.join(outDir, 'images');
  fs.mkdirSync(imagesDir, { recursive: true });

  // Image binaries are downloaded so they survive even if the source store is later wiped.
  type DownloadItem = { row: Record<string, unknown>; url: string; filename: string; field: string };
  const imageDownloads: DownloadItem[] = [];
  const collectionImageDownloads: DownloadItem[] = [];

  const productRows: Record<string, unknown>[] = [];
  const variantRows: Record<string, unknown>[] = [];
  const imageRows: Record<string, unknown>[] = [];
  const collectionRows: Record<string, unknown>[] = [];
  const collectionProductRows: Record<string, unknown>[] = [];
  const metafieldRows: Record<string, unknown>[] = [];
  const defRows: Record<string, unknown>[] = [];
  const metaobjectDefRows: Record<string, unknown>[] = [];
  const metaobjectRows: Record<string, unknown>[] = [];
  const locationRows: Record<string, unknown>[] = [];
  const inventoryRows: Record<string, unknown>[] = [];
  const themeRows: Record<string, unknown>[] = [];
  const themeFileRows: Record<string, unknown>[] = [];
  const nativeRows: Record<string, unknown>[] = [];
  let extraBytes = 0; // non-CSV artifacts (theme zips) to add to the reported size

  // ---------- Pass A: products (+variants, images, product metafields) ----------
  reporter.phase('Products');
  reporter.log.info('Starting product export (bulk operation)', 'Products');
  const prodBulk = await runBulkQuery(client, BULK_PRODUCTS, (c, s) => reporter.bulk(c, s));
  if (prodBulk.url) {
    const file = path.join(jsonlDir, 'products.jsonl');
    await downloadJsonl(prodBulk.url, file);
    const roots = stitch(await readBulkJsonl(file));
    for (const p of roots) {
      const handle = String(p.handle ?? '');
      const options = (p.options as any[]) ?? [];
      productRows.push({
        id: p.id,
        handle,
        title: p.title ?? '',
        description_html: p.descriptionHtml ?? '',
        vendor: p.vendor ?? '',
        product_type: p.productType ?? '',
        tags: JSON.stringify(p.tags ?? []),
        status: p.status ?? '',
        template_suffix: p.templateSuffix ?? '',
        category_id: (p.category as any)?.id ?? '',
        category_name: (p.category as any)?.fullName ?? '',
        seo_title: (p.seo as any)?.title ?? '',
        seo_description: (p.seo as any)?.description ?? '',
        options_json: JSON.stringify(options.map((o) => ({ name: o.name, position: o.position, values: (o.optionValues ?? []).map((v: any) => v.name) }))),
      });

      const variants = (p._children['ProductVariant'] ?? []).sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0));
      for (const v of variants) {
        const inv = (v.inventoryItem as any) ?? {};
        variantRows.push({
          id: v.id,
          product_handle: handle,
          sku: v.sku ?? '',
          title: v.title ?? '',
          option_values_json: JSON.stringify(v.selectedOptions ?? []),
          price: v.price ?? '',
          compare_at_price: v.compareAtPrice ?? '',
          cost: inv.cost?.amount ?? '',
          barcode: v.barcode ?? '',
          inventory_policy: v.inventoryPolicy ?? '',
          taxable: v.taxable ?? '',
          tax_code: v.taxCode ?? '',
          position: v.position ?? '',
          weight_value: inv.measurement?.weight?.value ?? '',
          weight_unit: inv.measurement?.weight?.unit ?? '',
        });
      }

      const images = p._children['MediaImage'] ?? [];
      images.forEach((m, i) => {
        const url = (m.image as any)?.url ?? '';
        const filename = url ? imageFilename(handle, i + 1, url) : '';
        const row: Record<string, unknown> = { product_handle: handle, position: i + 1, src: url, alt: m.alt ?? '', media_id: m.id, filename, file: '' };
        imageRows.push(row);
        if (url) imageDownloads.push({ row, url, filename, field: 'file' });
      });

      for (const mf of p._children['Metafield'] ?? []) {
        metafieldRows.push({ owner_type: 'PRODUCT', owner_key: handle, namespace: mf.namespace, key: mf.key, type: mf.type, value: mf.value });
      }

      buildNativeRows(nativeRows, p, variants, images);
    }
  }

  // Download image binaries so restore never depends on live source URLs.
  await downloadBinaries(imageDownloads, imagesDir, reporter, 'Downloading product images');
  reporter.log.info(`Products: ${productRows.length}, variants: ${variantRows.length}, images: ${imageRows.length}`, 'Products');

  // ---------- Pass B: variant metafields (separate root) ----------
  reporter.phase('Variant metafields');
  const vmBulk = await runBulkQuery(client, BULK_VARIANT_METAFIELDS, (c, s) => reporter.bulk(c, s));
  let variantMfCount = 0;
  if (vmBulk.url) {
    const file = path.join(jsonlDir, 'variant_metafields.jsonl');
    await downloadJsonl(vmBulk.url, file);
    const roots = stitch(await readBulkJsonl(file));
    for (const v of roots) {
      const productHandle = (v.product as any)?.handle ?? '';
      const ownerKey = `${productHandle}::${v.sku ?? ''}`;
      for (const mf of v._children['Metafield'] ?? []) {
        metafieldRows.push({ owner_type: 'PRODUCTVARIANT', owner_key: ownerKey, namespace: mf.namespace, key: mf.key, type: mf.type, value: mf.value });
        variantMfCount++;
      }
    }
  }
  reporter.log.info(`Variant metafields: ${variantMfCount}`, 'Variant metafields');

  // ---------- Pass C: collections (+membership, collection metafields) ----------
  reporter.phase('Collections');
  const colBulk = await runBulkQuery(client, BULK_COLLECTIONS, (c, s) => reporter.bulk(c, s));
  if (colBulk.url) {
    const file = path.join(jsonlDir, 'collections.jsonl');
    await downloadJsonl(colBulk.url, file);
    const roots = stitch(await readBulkJsonl(file));
    for (const c of roots) {
      const handle = String(c.handle ?? '');
      const imgUrl = (c.image as any)?.url ?? '';
      const imgFilename = imgUrl ? imageFilename(`collection_${handle}`, 0, imgUrl) : '';
      const ruleSet = c.ruleSet as any;
      const rules = ruleSet?.rules ?? [];
      const isSmart = Array.isArray(rules) && rules.length > 0;
      const colRow: Record<string, unknown> = {
        id: c.id,
        handle,
        title: c.title ?? '',
        description_html: c.descriptionHtml ?? '',
        sort_order: c.sortOrder ?? '',
        template_suffix: c.templateSuffix ?? '',
        seo_title: (c.seo as any)?.title ?? '',
        seo_description: (c.seo as any)?.description ?? '',
        image_src: imgUrl,
        image_alt: (c.image as any)?.altText ?? '',
        image_filename: imgFilename,
        image_file: '',
        collection_type: isSmart ? 'smart' : 'manual',
        applied_disjunctively: ruleSet ? String(ruleSet.appliedDisjunctively ?? false) : '',
        rules_json: isSmart ? JSON.stringify(rules.map((r: any) => ({ column: r.column, relation: r.relation, condition: r.condition }))) : '',
        sources_json: JSON.stringify(c.sources ?? []),
      };
      collectionRows.push(colRow);
      if (imgUrl) collectionImageDownloads.push({ row: colRow, url: imgUrl, filename: imgFilename, field: 'image_file' });
      for (const prod of c._children['Product'] ?? []) {
        collectionProductRows.push({ collection_handle: handle, product_handle: prod.handle ?? '' });
      }
      for (const mf of c._children['Metafield'] ?? []) {
        metafieldRows.push({ owner_type: 'COLLECTION', owner_key: handle, namespace: mf.namespace, key: mf.key, type: mf.type, value: mf.value });
      }
    }
  }
  await downloadBinaries(collectionImageDownloads, imagesDir, reporter, 'Downloading collection images');
  reporter.log.info(`Collections: ${collectionRows.length}`, 'Collections');

  // ---------- Pass D: metafield definitions ----------
  reporter.phase('Metafield definitions');
  for (let i = 0; i < DEFINITION_OWNER_TYPES.length; i++) {
    const ownerType = DEFINITION_OWNER_TYPES[i];
    reporter.determinate(i, DEFINITION_OWNER_TYPES.length, `Definitions: ${ownerType}`);
    let after: string | null = null;
    do {
      const res = await client.graphql<any>(METAFIELD_DEFINITIONS, { ownerType, after });
      const conn: any = res.data.metafieldDefinitions;
      for (const edge of conn.edges) {
        const n = edge.node;
        defRows.push({
          owner_type: ownerType,
          namespace: n.namespace,
          key: n.key,
          name: n.name,
          description: n.description ?? '',
          type: n.type?.name ?? '',
          pinned_position: n.pinnedPosition ?? '',
          validations_json: JSON.stringify(n.validations ?? []),
          access_json: JSON.stringify(n.access ?? {}),
        });
      }
      after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (after);
  }
  reporter.determinate(DEFINITION_OWNER_TYPES.length, DEFINITION_OWNER_TYPES.length);
  reporter.log.info(`Metafield definitions: ${defRows.length}`, 'Metafield definitions');

  // ---------- Pass E: metaobject definitions + entries ----------
  reporter.phase('Metaobjects');
  const types: string[] = [];
  let after: string | null = null;
  do {
    const res = await client.graphql<any>(METAOBJECT_DEFINITIONS, { after });
    const conn: any = res.data.metaobjectDefinitions;
    for (const edge of conn.edges) {
      const n = edge.node;
      types.push(n.type);
      metaobjectDefRows.push({
        id: n.id,
        type: n.type,
        name: n.name,
        display_name_key: n.displayNameKey ?? '',
        field_definitions_json: JSON.stringify(n.fieldDefinitions ?? []),
        capabilities_json: JSON.stringify(n.capabilities ?? {}),
        access_json: JSON.stringify(n.access ?? {}),
      });
    }
    after = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
  } while (after);

  for (let i = 0; i < types.length; i++) {
    reporter.determinate(i, types.length, `Metaobjects: ${types[i]}`);
    let moAfter: string | null = null;
    do {
      const res = await client.graphql<any>(METAOBJECTS_BY_TYPE, { type: types[i], after: moAfter });
      const conn: any = res.data.metaobjects;
      for (const edge of conn.edges) {
        const n = edge.node;
        metaobjectRows.push({ id: n.id, type: n.type, handle: n.handle, display_name: n.displayName ?? '', fields_json: JSON.stringify(n.fields ?? []) });
      }
      moAfter = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (moAfter);
  }
  reporter.determinate(types.length, types.length);
  reporter.log.info(`Metaobject definitions: ${metaobjectDefRows.length}, entries: ${metaobjectRows.length}`, 'Metaobjects');

  // ---------- Pass F: locations + multi-location inventory ----------
  // Wrapped so a store/plan without inventory access degrades gracefully instead of failing the whole backup.
  reporter.phase('Inventory');
  try {
    let locAfter: string | null = null;
    do {
      const res = await client.graphql<any>(LOCATIONS, { after: locAfter });
      const conn: any = res.data.locations;
      for (const edge of conn.edges) {
        const n = edge.node;
        locationRows.push({
          name: n.name,
          is_active: String(n.isActive ?? ''),
          legacy_id: n.legacyResourceId ?? '',
          address_json: JSON.stringify(n.address ?? {}),
        });
      }
      locAfter = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (locAfter);

    const invBulk = await runBulkQuery(client, BULK_INVENTORY, (c, s) => reporter.bulk(c, s));
    if (invBulk.url) {
      const file = path.join(jsonlDir, 'inventory.jsonl');
      await downloadJsonl(invBulk.url, file);
      const roots = stitch(await readBulkJsonl(file));
      for (const item of roots) {
        const variant = (item.variant as any) ?? {};
        const productHandle = variant.product?.handle ?? '';
        const sku = variant.sku ?? '';
        if (!variant.id) continue; // inventory item not tied to a variant we track
        for (const lvl of item._children['InventoryLevel'] ?? []) {
          const q: Record<string, number> = {};
          for (const entry of ((lvl.quantities as any[]) ?? [])) q[entry.name] = entry.quantity;
          inventoryRows.push({
            variant_id: variant.id,
            inventory_item_id: item.id,
            product_handle: productHandle,
            variant_sku: sku,
            option_values: JSON.stringify(variant.selectedOptions ?? []),
            location_name: (lvl.location as any)?.name ?? '',
            tracked: String(item.tracked ?? ''),
            on_hand: q.on_hand ?? '',
            available: q.available ?? '',
            committed: q.committed ?? '',
            incoming: q.incoming ?? '',
            reserved: q.reserved ?? '',
            damaged: q.damaged ?? '',
            safety_stock: q.safety_stock ?? '',
            quality_control: q.quality_control ?? '',
          });
        }
      }
    }
    reporter.log.info(`Locations: ${locationRows.length}, inventory levels: ${inventoryRows.length}`, 'Inventory');
  } catch (err) {
    reporter.log.warn(`Inventory capture skipped: ${(err as Error).message} (check read_inventory / read_locations scopes)`, 'Inventory');
  }

  // ---------- Pass G: published theme -> downloadable zip (backup only) ----------
  reporter.phase('Theme');
  try {
    const res = await client.graphql<any>(THEMES);
    const themes: any[] = res.data.themes?.nodes ?? [];
    const main = themes.find((t) => t.role === 'MAIN') ?? themes[0];
    if (main) {
      const workDir = path.join(outDir, 'themes', sanitizeName(main.name));
      fs.mkdirSync(workDir, { recursive: true });
      const urlDownloads: Array<{ url: string; target: string }> = [];
      let cursor: string | null = null;
      let fileCount = 0;
      do {
        const fr = await client.graphql<any>(THEME_FILES, { id: main.id, cursor });
        const conn: any = fr.data.theme.files;
        for (const node of conn.nodes) {
          const rel = String(node.filename).replace(/\\/g, '/');
          const target = path.resolve(workDir, rel);
          if (target !== workDir && !target.startsWith(workDir + path.sep)) continue; // path-escape guard
          fs.mkdirSync(path.dirname(target), { recursive: true });
          const body = node.body ?? {};
          if (body.__typename === 'OnlineStoreThemeFileBodyText') fs.writeFileSync(target, body.content ?? '', 'utf8');
          else if (body.__typename === 'OnlineStoreThemeFileBodyBase64') fs.writeFileSync(target, Buffer.from(body.contentBase64 ?? '', 'base64'));
          else if (body.__typename === 'OnlineStoreThemeFileBodyUrl' && body.url) urlDownloads.push({ url: body.url, target });
          themeFileRows.push({ theme_name: main.name, filename: rel, content_type: node.contentType ?? '', size: node.size ?? '', checksum: node.checksumMd5 ?? '' });
          fileCount++;
        }
        reporter.bulk(fileCount, 'reading theme files');
        cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
      } while (cursor);

      // Download any URL-bodied (binary) assets.
      for (let i = 0; i < urlDownloads.length; i += 6) {
        await Promise.all(urlDownloads.slice(i, i + 6).map(async (d) => {
          try { const r = await fetch(d.url); if (r.ok) fs.writeFileSync(d.target, Buffer.from(await r.arrayBuffer())); } catch { /* skip */ }
        }));
        reporter.determinate(Math.min(i + 6, urlDownloads.length), urlDownloads.length, 'Downloading theme assets');
      }

      // Package into a valid, uploadable Shopify theme zip at the backup root, then drop the working files.
      const zipName = `theme_${sanitizeName(main.name)}.zip`;
      await zipDir(workDir, path.join(outDir, zipName));
      fs.rmSync(path.join(outDir, 'themes'), { recursive: true, force: true });
      extraBytes += fs.statSync(path.join(outDir, zipName)).size;
      themeRows.push({ name: main.name, role: main.role, theme_store_id: main.themeStoreId ?? '', zip_file: zipName });
      reporter.log.info(`Theme "${main.name}" (${main.role}) — ${themeFileRows.length} files → ${zipName}`, 'Theme');
    } else {
      reporter.log.info('No theme found to back up.', 'Theme');
    }
  } catch (err) {
    reporter.log.warn(`Theme backup skipped: ${(err as Error).message} (check read_themes scope)`, 'Theme');
  }

  // ---------- Write CSVs + manifest ----------
  const writes: Array<[string, readonly string[], Record<string, unknown>[]]> = [
    [FILES.products, COLS.products, productRows],
    [FILES.variants, COLS.variants, variantRows],
    [FILES.images, COLS.images, imageRows],
    [FILES.collections, COLS.collections, collectionRows],
    [FILES.collectionProducts, COLS.collectionProducts, collectionProductRows],
    [FILES.metafields, COLS.metafields, metafieldRows],
    [FILES.metafieldDefinitions, COLS.metafieldDefinitions, defRows],
    [FILES.metaobjectDefinitions, COLS.metaobjectDefinitions, metaobjectDefRows],
    [FILES.metaobjects, COLS.metaobjects, metaobjectRows],
    [FILES.locations, COLS.locations, locationRows],
    [FILES.inventoryLevels, COLS.inventoryLevels, inventoryRows],
    [FILES.themes, COLS.themes, themeRows],
    [FILES.themeFiles, COLS.themeFiles, themeFileRows],
    [FILES.productsNative, COLS.productsNative, nativeRows],
  ];

  const fileMeta: Array<{ name: string; rows: number; sha256: string; bytes: number }> = [];
  let sizeBytes = 0;
  for (const [name, cols, rows] of writes) {
    const fp = path.join(outDir, name);
    const rowCount = writeCsv(fp, [...cols], rows);
    const bytes = fs.statSync(fp).size;
    sizeBytes += bytes;
    fileMeta.push({ name, rows: rowCount, sha256: sha256File(fp), bytes });
  }
  // Include downloaded image binaries and the theme zip in the reported backup size.
  sizeBytes += dirSize(imagesDir) + extraBytes;

  const counts = {
    products: productRows.length,
    variants: variantRows.length,
    images: imageRows.length,
    collections: collectionRows.length,
    metafields: metafieldRows.length,
    metafield_definitions: defRows.length,
    metaobject_definitions: metaobjectDefRows.length,
    metaobjects: metaobjectRows.length,
    locations: locationRows.length,
    inventory_levels: inventoryRows.length,
    themes: themeRows.length,
    theme_files: themeFileRows.length,
  };

  const manifest = {
    tool: 'coalition-snapback',
    schemaVersion: SCHEMA_VERSION,
    store: { name: store.name, domain: store.domain, apiVersion: store.apiVersion },
    createdAt: new Date().toISOString(),
    counts,
    files: fileMeta,
  };
  fs.writeFileSync(path.join(outDir, FILES.manifest), JSON.stringify(manifest, null, 2), 'utf8');

  // Verify checksums by recomputing (cheap integrity check).
  let checksumOk = true;
  for (const f of fileMeta) {
    if (sha256File(path.join(outDir, f.name)) !== f.sha256) checksumOk = false;
  }

  // Remove raw JSONL to save space (comment out to keep for debugging).
  try { fs.rmSync(jsonlDir, { recursive: true, force: true }); } catch { /* ignore */ }

  return { counts, sizeBytes, manifest, checksumOk };
}

function sanitizeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Download a batch of image binaries into imagesDir, setting each row's target field on success. */
async function downloadBinaries(
  items: Array<{ row: Record<string, unknown>; url: string; filename: string; field: string }>,
  imagesDir: string, reporter: Reporter, label: string,
): Promise<void> {
  if (!items.length) return;
  const CONCURRENCY = 6;
  let done = 0;
  let failed = 0;
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (d) => {
      try {
        const res = await fetch(d.url);
        if (res.ok) {
          fs.writeFileSync(path.join(imagesDir, d.filename), Buffer.from(await res.arrayBuffer()));
          d.row[d.field] = `images/${d.filename}`;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
      done++;
    }));
    reporter.determinate(done, items.length, label);
  }
  if (failed) reporter.log.warn(`Could not download ${failed}/${items.length} image(s); those keep only their URL`);
}

/** Deterministic, collision-resistant local filename for a product image. */
function imageFilename(handle: string, position: number, url: string): string {
  const base = (url.split('?')[0].split('/').pop() || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${sanitizeName(handle)}_${position}_${base}`.slice(0, 120);
}

// Build Shopify-native-style repeated-handle rows for products_native.csv.
function buildNativeRows(out: Record<string, unknown>[], p: JsonlNode & { _children: Record<string, JsonlNode[]> }, variants: JsonlNode[], images: JsonlNode[]) {
  const handle = String(p.handle ?? '');
  const options = (p.options as any[]) ?? [];
  const optNames = [options[0]?.name ?? '', options[1]?.name ?? '', options[2]?.name ?? ''];
  const tags = Array.isArray(p.tags) ? (p.tags as string[]).join(', ') : '';
  const published = p.status === 'ACTIVE' ? 'true' : 'false';
  const rowCount = Math.max(variants.length, images.length, 1);

  for (let i = 0; i < rowCount; i++) {
    const v = variants[i];
    const img = images[i];
    const sel = (v?.selectedOptions as any[]) ?? [];
    out.push({
      Handle: handle,
      Title: i === 0 ? p.title ?? '' : '',
      'Body (HTML)': i === 0 ? p.descriptionHtml ?? '' : '',
      Vendor: i === 0 ? p.vendor ?? '' : '',
      Type: i === 0 ? p.productType ?? '' : '',
      Tags: i === 0 ? tags : '',
      Published: i === 0 ? published : '',
      'Option1 Name': i === 0 ? optNames[0] : '',
      'Option1 Value': sel[0]?.value ?? '',
      'Option2 Name': i === 0 ? optNames[1] : '',
      'Option2 Value': sel[1]?.value ?? '',
      'Option3 Name': i === 0 ? optNames[2] : '',
      'Option3 Value': sel[2]?.value ?? '',
      'Variant SKU': v?.sku ?? '',
      'Variant Price': v?.price ?? '',
      'Variant Compare At Price': v?.compareAtPrice ?? '',
      'Variant Barcode': v?.barcode ?? '',
      'Image Src': (img?.image as any)?.url ?? '',
      'Image Position': img ? i + 1 : '',
      Status: i === 0 ? p.status ?? '' : '',
    });
  }
}
