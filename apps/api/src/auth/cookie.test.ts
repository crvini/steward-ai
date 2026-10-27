import { describe, expect, it } from 'vitest';

import {
  SESSION_MAX_AGE_SECONDS,
  buildCookie,
  readCookie,
  signSession,
  verifySession,
} from './cookie.js';

const SECRET = 'test-secret-not-a-real-one';
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);

describe('signSession / verifySession', () => {
  it('round-trips a session', () => {
    const token = signSession({ userId: 'user-1', issuedAt: NOW }, SECRET);
    expect(verifySession(token, SECRET, NOW)).toEqual({ userId: 'user-1', issuedAt: NOW });
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession({ userId: 'user-1', issuedAt: NOW }, 'other-secret');
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it('rejects a tampered payload — the whole point of signing it', () => {
    const token = signSession({ userId: 'donor-1', issuedAt: NOW }, SECRET);
    const [, sig] = token.split('.');
    // Someone swapping themselves into the treasurer's id keeps the signature.
    const forged = Buffer.from(JSON.stringify({ userId: 'treasurer-1', issuedAt: NOW })).toString(
      'base64url',
    );
    expect(verifySession(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('rejects an expired session', () => {
    const token = signSession({ userId: 'user-1', issuedAt: NOW }, SECRET);
    const justInside = NOW + (SESSION_MAX_AGE_SECONDS - 1) * 1000;
    const justOutside = NOW + (SESSION_MAX_AGE_SECONDS + 1) * 1000;
    expect(verifySession(token, SECRET, justInside)).not.toBeNull();
    expect(verifySession(token, SECRET, justOutside)).toBeNull();
  });

  it('rejects a session issued in the future', () => {
    const token = signSession({ userId: 'user-1', issuedAt: NOW + 60_000 }, SECRET);
    expect(verifySession(token, SECRET, NOW)).toBeNull();
  });

  it('returns null for junk instead of throwing', () => {
    for (const bad of [
      undefined,
      '',
      '.',
      'nodot',
      'a.',
      '.b',
      'not-base64.not-base64',
      // Valid signature over a payload that is not a session object.
      signSession({ nope: true } as never, SECRET),
    ]) {
      expect(verifySession(bad as string | undefined, SECRET, NOW)).toBeNull();
    }
  });
});

describe('readCookie', () => {
  it('finds the cookie among others', () => {
    expect(readCookie('a=1; steward_session=abc; b=2', 'steward_session')).toBe('abc');
    expect(readCookie('steward_session=abc', 'steward_session')).toBe('abc');
  });

  it('does not match a cookie whose name merely ends the same', () => {
    expect(readCookie('not_steward_session=abc', 'steward_session')).toBeUndefined();
  });

  it('handles a missing or empty header', () => {
    expect(readCookie(undefined, 'steward_session')).toBeUndefined();
    expect(readCookie('', 'steward_session')).toBeUndefined();
  });
});

describe('buildCookie', () => {
  it('is httpOnly and SameSite=Lax, and Secure only in production', () => {
    const prod = buildCookie('v', { secure: true, maxAge: 60 });
    expect(prod).toContain('HttpOnly');
    expect(prod).toContain('SameSite=Lax');
    expect(prod).toContain('Secure');

    // Secure would stop the cookie working over plain http in local dev.
    expect(buildCookie('v', { secure: false, maxAge: 60 })).not.toContain('Secure');
  });
});
