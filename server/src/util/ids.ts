import { randomUUID, randomBytes } from 'node:crypto';

/** Short opaque id for rows (URL-safe). */
export function newId(prefix = ''): string {
  const raw = randomBytes(12).toString('base64url');
  return prefix ? `${prefix}_${raw}` : raw;
}

/** Full UUID (used for session ids / run ids). */
export function uuid(): string {
  return randomUUID();
}

/** Extract the numeric id portion from a Shopify GID, e.g. gid://shopify/Product/123 -> "123". */
export function gidId(gid: string): string {
  const parts = gid.split('/');
  return parts[parts.length - 1] ?? gid;
}

/** Extract the resource type from a Shopify GID, e.g. gid://shopify/Product/123 -> "Product". */
export function gidType(gid: string): string {
  const parts = gid.split('/');
  return parts[parts.length - 2] ?? '';
}
