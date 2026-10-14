import 'dotenv/config';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const envSchema = z.object({
  APP_PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().default('./data'),
  APP_ENCRYPTION_KEY: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  TZ: z.string().default('UTC'),
  APP_BASE_URL: z.string().default('http://localhost:8080'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  NODE_ENV: z.string().default('development'),
});

const parsed = envSchema.parse(process.env);

const dataDir = path.resolve(parsed.DATA_DIR);
fs.mkdirSync(dataDir, { recursive: true });

/**
 * For a smooth first-run on localhost we auto-generate encryption/session keys if
 * they aren't provided, and persist them under DATA_DIR so restarts stay consistent.
 * In production you should set them explicitly via .env.
 */
function loadOrCreateSecret(name: string, provided: string | undefined): string {
  if (provided && provided.length >= 16) return provided;
  const file = path.join(dataDir, `.${name}`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const encryptionKey = loadOrCreateSecret('encryption_key', parsed.APP_ENCRYPTION_KEY);
const sessionSecret = loadOrCreateSecret('session_secret', parsed.SESSION_SECRET);

export const config = {
  port: parsed.APP_PORT,
  dataDir,
  dbPath: path.join(dataDir, 'app.db'),
  backupsDir: path.join(dataDir, 'backups'),
  logsDir: path.join(dataDir, 'logs'),
  encryptionKey,
  sessionSecret,
  timezone: parsed.TZ,
  baseUrl: parsed.APP_BASE_URL.replace(/\/$/, ''),
  isProd: parsed.NODE_ENV === 'production',
  google: {
    clientId: parsed.GOOGLE_CLIENT_ID || '',
    clientSecret: parsed.GOOGLE_CLIENT_SECRET || '',
    apiKey: parsed.GOOGLE_API_KEY || '',
    get enabled() {
      return Boolean(parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET);
    },
    get redirectUri() {
      return `${parsed.APP_BASE_URL.replace(/\/$/, '')}/api/drive/oauth/callback`;
    },
  },
  // SMTP env fallback (the in-app Settings page takes precedence when configured).
  smtpEnv: parsed.SMTP_HOST
    ? {
        host: parsed.SMTP_HOST,
        port: parsed.SMTP_PORT ?? 587,
        secure: parsed.SMTP_SECURE === 'true',
        user: parsed.SMTP_USER ?? '',
        pass: parsed.SMTP_PASS ?? '',
        from: parsed.MAIL_FROM ?? parsed.SMTP_USER ?? '',
      }
    : null,
  defaultApiVersion: '2026-07',
} as const;

fs.mkdirSync(config.backupsDir, { recursive: true });
fs.mkdirSync(config.logsDir, { recursive: true });
