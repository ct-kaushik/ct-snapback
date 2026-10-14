import { randomBytes, createHash } from 'node:crypto';
import { db, nowIso, type AuthTokenRow } from '../db/index.js';
import { newId } from '../util/ids.js';

export type TokenPurpose = 'invite' | 'verify' | 'reset';

// Expiries: invites are long-lived, verification a day, password resets short.
export const TOKEN_TTL: Record<TokenPurpose, number> = {
  invite: 7 * 24 * 60 * 60 * 1000,
  verify: 24 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
};

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Create a single-use token; only the hash is stored. Returns the raw token for the email link. */
export function createAuthToken(userId: string, purpose: TokenPurpose): string {
  const raw = randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO auth_tokens (id,user_id,token_hash,purpose,expires_at,created_at) VALUES (?,?,?,?,?,?)',
  ).run(newId('tok'), userId, hashToken(raw), purpose, new Date(Date.now() + TOKEN_TTL[purpose]).toISOString(), nowIso());
  return raw;
}

/** Validate + burn a token. Returns the userId, or null if invalid/expired/used. */
export function consumeAuthToken(raw: string, purpose: TokenPurpose): string | null {
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ?').get(hashToken(raw), purpose) as AuthTokenRow | undefined;
  if (!row || row.used_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return row.user_id;
}
