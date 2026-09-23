/**
 * In-memory rate limiter for wrong admin-password attempts, keyed by client
 * IP + tournament id. No persistence needed: a restart resetting the counters
 * is an acceptable tradeoff for a single small process with no shared state.
 *
 * A key sits in `attempts` until it either succeeds (`clear`), expires
 * (`sweep`, hourly), or `maxKeys` is exceeded, whichever comes first. Without
 * that cap, a flood of requests each carrying a distinct client key (for
 * example many different tournament ids, or - before the rate limiter's key
 * was hardened - many spoofed addresses) would grow this map without bound
 * for up to an hour between sweeps. `maxKeys` bounds it instead: once full,
 * the oldest tracked key is evicted to make room. That is a rare, low-stakes
 * loss (one attacker's failure count resets a little early) traded for a
 * hard memory ceiling; 50,000 keys is a few MB at most, comfortably more
 * than any real deployment of this app sees concurrently.
 */
export class RateLimiter {
  private readonly attempts = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly windowMs = 10 * 60 * 1000,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 50_000,
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
      if (!this.attempts.has(key) && this.attempts.size >= this.maxKeys) {
        // Map iteration order is insertion order, and every existing key was
        // (re)inserted the last time its window opened, so the first key
        // here is the one that has gone longest without a fresh attempt.
        const oldestKey = this.attempts.keys().next().value;
        if (oldestKey !== undefined) this.attempts.delete(oldestKey);
      }
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
