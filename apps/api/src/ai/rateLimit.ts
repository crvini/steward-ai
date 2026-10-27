/**
 * Rate limit for the AI endpoints.
 *
 * The demo is on a public URL with a live Anthropic key. Without this, anyone
 * who finds the link can spend the project's quota, and a hackathon demo that
 * runs out of credit the day the judges open it is a lost project. This ships
 * in the same change as the first AI endpoint, not later.
 *
 * In-memory on purpose: one process, one demo. A second instance would need
 * shared state, and the code should say so rather than pretend otherwise.
 */
export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    this.sweep(now);

    const bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true, remaining: this.limit - 1 };
    }

    if (bucket.count >= this.limit) {
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    bucket.count += 1;
    return { allowed: true, remaining: this.limit - bucket.count };
  }

  /** Drops expired buckets so a long-running process does not grow forever. */
  private sweep(now: number) {
    if (this.buckets.size < 1000) return;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
