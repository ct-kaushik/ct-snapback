import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { Settings, type SmtpConfig } from '../db/models.js';

/** Resolve SMTP config: in-app Settings first, then env fallback. */
export function getSmtp(): SmtpConfig | null {
  const fromSettings = Settings.getSmtp();
  if (fromSettings?.host) return fromSettings;
  if (config.smtpEnv?.host) return { ...config.smtpEnv };
  return null;
}

export function smtpConfigured(): boolean {
  return Boolean(getSmtp());
}

function transporterFor(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    pool: true,
  });
}

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const cfg = getSmtp();
  if (!cfg) throw new Error('SMTP is not configured');
  await transporterFor(cfg).sendMail({ from: cfg.from || cfg.user, to, subject, html });
}

/** Validate a candidate SMTP config (connection + auth) without saving. */
export async function verifySmtp(cfg: SmtpConfig): Promise<void> {
  await transporterFor(cfg).verify();
}

// ---- Templates ----
const shell = (title: string, body: string) => `
  <div style="font-family:system-ui,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#14201e">
    <h2 style="color:#1c6fb8;margin:0 0 12px">${title}</h2>
    ${body}
    <p style="color:#8a97a3;font-size:12px;margin-top:24px">Coalition Snapback</p>
  </div>`;

const button = (url: string, label: string) =>
  `<p><a href="${url}" style="display:inline-block;background:#1c6fb8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px">${label}</a></p>
   <p style="color:#8a97a3;font-size:12px">Or paste this link: ${url}</p>`;

export const emailTemplates = {
  invite: (name: string, url: string) =>
    shell('You’ve been invited', `<p>Hi ${name || 'there'}, you’ve been invited to Coalition Snapback. Set your password to activate your account:</p>${button(url, 'Set your password')}<p style="color:#8a97a3;font-size:12px">This invite expires in 7 days.</p>`),
  reset: (name: string, url: string) =>
    shell('Reset your password', `<p>Hi ${name || 'there'}, we received a request to reset your password. This link expires in 1 hour:</p>${button(url, 'Choose a new password')}<p style="color:#8a97a3;font-size:12px">If you didn’t request this, you can ignore this email.</p>`),
  resetConfirm: (name: string) =>
    shell('Your password was changed', `<p>Hi ${name || 'there'}, your Coalition Snapback password was just changed. If this wasn’t you, contact your administrator immediately.</p>`),
  test: () => shell('SMTP test', '<p>✅ Your SMTP settings work. Coalition Snapback can send email.</p>'),
};
