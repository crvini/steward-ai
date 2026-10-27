/**
 * Signed demo-session cookie.
 *
 * Deliberately tiny: the hackathon demo has no passwords and no sign-up —
 * judges pick a role and are in (see docs/SPEC.md §3 and the judging notes).
 * What the signature buys us is that the *role* cannot be forged from the
 * browser, so "treasurer approved" in the audit log means something.
 *
 * Pure and dependency-free so it can be unit-tested without a server, a
 * database, or a .env.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'steward_session';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export type SessionPayload = { userId: string; issuedAt: number };

const b64url = (buf: Buffer) => buf.toString('base64url');

function signature(payload: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest());
}

export function signSession(payload: SessionPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${body}.${signature(body, secret)}`;
}

/**
 * Returns null for anything that is not a valid, unexpired, correctly signed
 * session. Never throws: a malformed cookie is an anonymous visitor, not a 500.
 */
export function verifySession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): SessionPayload | null {
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;

  const body = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(body, secret));

  // Length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as SessionPayload).userId !== 'string' ||
    typeof (payload as SessionPayload).issuedAt !== 'number'
  ) {
    return null;
  }

  const session = payload as SessionPayload;
  if (!session.userId) return null;

  const ageSeconds = (now - session.issuedAt) / 1000;
  if (ageSeconds < 0 || ageSeconds > SESSION_MAX_AGE_SECONDS) return null;

  return session;
}

/** Minimal cookie-header parser; avoids a dependency for one header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function buildCookie(value: string, options: { secure: boolean; maxAge: number }): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${options.maxAge}`,
  ];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
