import bcrypt from 'bcryptjs';
import { db, nowIso, type UserRow, type Role } from '../db/index.js';
import { uuid } from '../util/ids.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function createSession(userId: string): string {
  const id = uuid();
  const now = Date.now();
  db.prepare('INSERT INTO sessions (id,user_id,created_at,expires_at) VALUES (?,?,?,?)').run(
    id, userId, nowIso(), new Date(now + SESSION_TTL_MS).toISOString(),
  );
  return id;
}

export function getSessionUser(sessionId: string | undefined): UserRow | null {
  if (!sessionId) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as { user_id: string; expires_at: string } | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id) as UserRow | undefined;
  if (!user || !user.is_active) return null;
  return user;
}

export function destroySession(sessionId: string | undefined): void {
  if (sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

// Role hierarchy: admin > operator > viewer
const RANK: Record<Role, number> = { viewer: 1, operator: 2, admin: 3 };
export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

export const SESSION_COOKIE = 'sbid';
