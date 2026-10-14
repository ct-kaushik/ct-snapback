import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
];

export function driveEnabled(): boolean {
  return config.google.enabled;
}

export function oauthClient(): OAuth2Client {
  return new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);
}

export function authUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh_token
    scope: DRIVE_SCOPES,
    state,
  });
}

/** Exchange an OAuth code for tokens + the account email. */
export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string }> {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const me = await oauth2.userinfo.get();
  if (!tokens.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove app access in your Google account and reconnect.');
  }
  return { refreshToken: tokens.refresh_token, email: me.data.email ?? 'unknown' };
}

function driveFor(refreshToken: string) {
  const client = oauthClient();
  client.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth: client });
}

/** List folders (optionally within a parent) for the folder picker fallback UI. */
export async function listFolders(refreshToken: string, parentId?: string): Promise<Array<{ id: string; name: string }>> {
  const drive = driveFor(refreshToken);
  const q = [`mimeType = 'application/vnd.google-apps.folder'`, 'trashed = false'];
  if (parentId) q.push(`'${parentId}' in parents`);
  const res = await drive.files.list({ q: q.join(' and '), fields: 'files(id,name)', pageSize: 200, orderBy: 'name' });
  return (res.data.files ?? []).map((f) => ({ id: f.id!, name: f.name! }));
}

/** Create (or reuse) a named subfolder under parentId (or Drive root). */
export async function ensureFolder(refreshToken: string, name: string, parentId?: string): Promise<{ id: string; name: string }> {
  const drive = driveFor(refreshToken);
  const q = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
    `name = '${name.replace(/'/g, "\\'")}'`,
  ];
  if (parentId) q.push(`'${parentId}' in parents`);
  const existing = await drive.files.list({ q: q.join(' and '), fields: 'files(id,name)' });
  if (existing.data.files?.length) return { id: existing.data.files[0].id!, name };
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : undefined },
    fields: 'id,name',
  });
  return { id: created.data.id!, name };
}

/** Upload a file into a Drive folder. Returns the new Drive file id. */
export async function uploadFile(
  refreshToken: string,
  folderId: string,
  filePath: string,
  fileName: string,
): Promise<string> {
  const drive = driveFor(refreshToken);
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: folderId ? [folderId] : undefined },
    media: { body: fs.createReadStream(filePath) },
    fields: 'id',
  });
  return res.data.id!;
}
