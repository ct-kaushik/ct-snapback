import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { stringify } from 'csv-stringify/sync';
import { parse } from 'csv-parse/sync';

/** Write rows (array of objects) to a CSV file with a fixed column order. Returns row count. */
export function writeCsv(filePath: string, columns: string[], rows: Record<string, unknown>[]): number {
  const records = rows.map((r) =>
    columns.map((c) => {
      const v = r[c];
      if (v === null || v === undefined) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }),
  );
  const csv = stringify([columns, ...records], {});
  fs.writeFileSync(filePath, csv, 'utf8');
  return rows.length;
}

/** Read a CSV file into an array of row objects keyed by header. */
export function readCsv(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true }) as Record<string, string>[];
}

export function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash('sha256').update(buf).digest('hex');
}
