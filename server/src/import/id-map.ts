import { isReferenceType } from '../export/schema.js';

/**
 * Maps original-store GIDs to the destination-store GIDs created during restore.
 * For same-store restore the mapping is often identity, but we still record it
 * so reference metafields resolve regardless of same/cross store.
 */
export class IdMap {
  private map = new Map<string, string>();
  unresolved = 0;

  set(oldGid: string, newGid: string): void {
    if (oldGid && newGid) this.map.set(oldGid, newGid);
  }

  get(oldGid: string): string | undefined {
    return this.map.get(oldGid);
  }

  /** Remap a metafield value that stores GIDs. Non-reference values are returned unchanged. */
  remapValue(type: string, value: string): string {
    if (!isReferenceType(type)) return value;

    if (type.startsWith('list.')) {
      let arr: unknown;
      try {
        arr = JSON.parse(value);
      } catch {
        return value;
      }
      if (!Array.isArray(arr)) return value;
      const mapped = arr.map((g) => this.remapGid(String(g)));
      return JSON.stringify(mapped);
    }
    return this.remapGid(value);
  }

  private remapGid(gid: string): string {
    if (!gid.startsWith('gid://shopify/')) return gid;
    const found = this.map.get(gid);
    if (found) return found;
    this.unresolved += 1;
    return gid; // keep original; same-store it may still be valid
  }
}
