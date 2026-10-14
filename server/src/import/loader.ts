import path from 'node:path';
import { readCsv } from '../export/csv.js';
import { FILES } from '../export/schema.js';

export interface BackupData {
  products: Record<string, string>[];
  variants: Record<string, string>[];
  images: Record<string, string>[];
  collections: Record<string, string>[];
  collectionProducts: Record<string, string>[];
  metafields: Record<string, string>[];
  defs: Record<string, string>[];
  metaobjectDefs: Record<string, string>[];
  metaobjects: Record<string, string>[];
  locations: Record<string, string>[];
  inventoryLevels: Record<string, string>[];
}

export function loadBackup(dir: string): BackupData {
  // readCsv returns [] for files that don't exist, so older backups load fine.
  return {
    products: readCsv(path.join(dir, FILES.products)),
    variants: readCsv(path.join(dir, FILES.variants)),
    images: readCsv(path.join(dir, FILES.images)),
    collections: readCsv(path.join(dir, FILES.collections)),
    collectionProducts: readCsv(path.join(dir, FILES.collectionProducts)),
    metafields: readCsv(path.join(dir, FILES.metafields)),
    defs: readCsv(path.join(dir, FILES.metafieldDefinitions)),
    metaobjectDefs: readCsv(path.join(dir, FILES.metaobjectDefinitions)),
    metaobjects: readCsv(path.join(dir, FILES.metaobjects)),
    locations: readCsv(path.join(dir, FILES.locations)),
    inventoryLevels: readCsv(path.join(dir, FILES.inventoryLevels)),
  };
}

export function safeParse<T>(json: string | undefined, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
