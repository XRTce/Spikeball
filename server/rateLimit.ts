/**
 * In-memory rate limiter for wrong admin-password attempts, keyed by client
 * IP + tournament id. No persistence needed: a restart resetting the counters
 * is an acceptable tradeoff for a single small process with no shared state.
 */
export class RateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when this key has already used up its failure budget for the current window. */
  isBlocked(key: string): boolean {
    const entry = this.attempts.get(key);
    if (!entry) return false;
    if (this.now() - entry.windowStart >= this.windowMs) {
      this.attempts.delete(key);
      return false;
    }
    return entry.count >= this.maxAttempts;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.attempts.get(key);
    if (!entry || now - entry.windowStart >= this.windowMs) {
      this.attempts.set(key, { count: 1, windowStart: now });
      return;
    }
    entry.count += 1;
  }

  /** Successful verification clears the key's history, so occasional typos don't add up. */
  clear(key: string): void {
    this.attempts.delete(key);
  }

  /** Drops stale entries; call this periodically so the map does not grow forever. */
  sweep(): void {
    const now = this.now();
    for (const [key, entry] of this.attempts) {
      if (now - entry.windowStart >= this.windowMs) this.attempts.delete(key);
    }
  }
}
