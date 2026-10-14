import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { config } from './config.js';

// AES-256-GCM encryption for secrets at rest (Shopify tokens, Google refresh tokens).
// Key is derived from APP_ENCRYPTION_KEY so it's always exactly 32 bytes.
const KEY = createHash('sha256').update(config.encryptionKey).digest();
const ALGO = 'aes-256-gcm';

/** Encrypt a string; output is "iv:tag:ciphertext" (all base64). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

/** Decrypt a value produced by encryptSecret. Returns '' if empty/invalid. */
export function decryptSecret(payload: string | null | undefined): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 3) return '';
  const [ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

/** Mask a secret for display, e.g. "shpat_ab...yz". */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
