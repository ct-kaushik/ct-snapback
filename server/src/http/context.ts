import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSessionUser, roleAtLeast, SESSION_COOKIE } from '../auth/index.js';
import { UserStores } from '../db/models.js';
import type { Role, UserRow } from '../db/index.js';

export function currentUser(req: FastifyRequest): UserRow | null {
  const raw = (req.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE];
  return getSessionUser(raw);
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Return the user or throw 401. */
export function requireUser(req: FastifyRequest): UserRow {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Not authenticated');
  return user;
}

export function requireRole(req: FastifyRequest, min: Role): UserRow {
  const user = requireUser(req);
  if (!roleAtLeast(user.role, min)) throw new HttpError(403, 'Insufficient permissions');
  return user;
}

export function canAccessStore(user: UserRow, storeId: string): boolean {
  if (user.role === 'admin') return true;
  return UserStores.storesFor(user.id).includes(storeId);
}

export function requireStoreAccess(req: FastifyRequest, storeId: string, min: Role = 'viewer'): UserRow {
  const user = requireRole(req, min);
  if (!canAccessStore(user, storeId)) throw new HttpError(403, 'No access to this store');
  return user;
}

/** Wrap an async handler so HttpError maps to a JSON error response. */
export function handler(fn: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await fn(req, reply);
      if (result !== undefined && !reply.sent) return reply.send(result);
      return undefined;
    } catch (err) {
      if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
      const message = err instanceof Error ? err.message : String(err);
      req.log.error(message);
      return reply.code(400).send({ error: message });
    }
  };
}

export function publicUser(user: UserRow) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}
