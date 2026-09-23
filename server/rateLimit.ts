/**
 * In-memory rate limiter for wrong admin-password attempts, keyed by client
 * IP + tournament id. No persistence needed: a restart resetting the counters
 * is an acceptable tradeoff for a single small process with no shared state.
 *
 * `maxKeys` bounds memory between hourly `sweep()` calls: once full, the
 * least recently active key is evicted to make room for a new one. 50,000
 * keys is a few MB at most, comfortably more than this app's real
 * deployments see concurrently.
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
    if (entry && now - entry.windowStart < this.windowMs) {
      entry.count += 1;
      return;
    }
    // Map iteration order is insertion order, so deleting before re-setting
    // moves this key to the end even when it already existed; that keeps
    // the map ordered by recency, and the first key below is the least
    // recently active one.
    this.attempts.delete(key);
    if (this.attempts.size >= this.maxKeys) {
      const oldestKey = this.attempts.keys().next().value;
      if (oldestKey !== undefined) this.attempts.delete(oldestKey);
    }
    this.attempts.set(key, { count: 1, windowStart: now });
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
