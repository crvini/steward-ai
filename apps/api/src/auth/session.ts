/**
 * Session middleware and the demo-role directory.
 */
import type { NextFunction, Request, Response } from 'express';
import { UserRole } from '@prisma/client';

import { prisma } from '../db/client.js';
import { env } from '../config/env.js';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  buildCookie,
  readCookie,
  signSession,
  verifySession,
} from './cookie.js';

/** Attaches `req.user` when the cookie carries a valid signature. */
export async function attachSession(req: Request, _res: Response, next: NextFunction) {
  req.user = null;
  try {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const session = verifySession(token, env.SESSION_SECRET);
    if (session) {
      req.user = await prisma.user.findUnique({
        where: { id: session.userId },
        select: { id: true, name: true, email: true, role: true, locale: true, churchId: true },
      });
    }
  } catch (error) {
    // A broken session must never take the site down; treat it as anonymous.
    console.warn('[session] could not resolve session:', error);
  }
  next();
}

export function setSessionCookie(res: Response, userId: string) {
  const token = signSession({ userId, issuedAt: Date.now() }, env.SESSION_SECRET);
  res.setHeader(
    'Set-Cookie',
    buildCookie(token, {
      secure: env.NODE_ENV === 'production',
      maxAge: SESSION_MAX_AGE_SECONDS,
    }),
  );
}

export function clearSessionCookie(res: Response) {
  res.setHeader('Set-Cookie', buildCookie('', { secure: env.NODE_ENV === 'production', maxAge: 0 }));
}

/** Rejects the request unless the signed-in user holds one of `roles`. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'not_signed_in' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'wrong_role', needs: roles, has: req.user.role });
    }
    next();
  };
}

export type { SessionUser } from './types.js';
