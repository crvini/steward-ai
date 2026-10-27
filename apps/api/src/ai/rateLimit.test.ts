import { describe, expect, it } from 'vitest';

import { RateLimiter } from './rateLimit.js';

const HORA = 3_600_000;

describe('RateLimiter', () => {
  it('allows up to the limit and then refuses', () => {
    const limiter = new RateLimiter(3, HORA);
    const t = 1_000_000;

    expect(limiter.check('a', t)).toEqual({ allowed: true, remaining: 2 });
    expect(limiter.check('a', t)).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.check('a', t)).toEqual({ allowed: true, remaining: 0 });

    const refused = limiter.check('a', t);
    expect(refused.allowed).toBe(false);
  });

  it('keeps callers separate', () => {
    const limiter = new RateLimiter(1, HORA);
    const t = 1_000_000;

    expect(limiter.check('a', t).allowed).toBe(true);
    // One caller exhausting their quota must not lock everyone else out.
    expect(limiter.check('b', t).allowed).toBe(true);
    expect(limiter.check('a', t).allowed).toBe(false);
  });

  it('refills once the window passes', () => {
    const limiter = new RateLimiter(1, HORA);
    const t = 1_000_000;

    expect(limiter.check('a', t).allowed).toBe(true);
    expect(limiter.check('a', t + HORA - 1).allowed).toBe(false);
    expect(limiter.check('a', t + HORA).allowed).toBe(true);
  });

  it('reports how long to wait', () => {
    const limiter = new RateLimiter(1, 60_000);
    const t = 1_000_000;

    limiter.check('a', t);
    const refused = limiter.check('a', t + 10_000);
    expect(refused).toEqual({ allowed: false, retryAfterSeconds: 50 });
  });
});
