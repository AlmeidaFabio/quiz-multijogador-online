interface WindowEntry {
  count: number;
  expiresAt: number;
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private callsUntilCleanup = 256;

  consume(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    this.callsUntilCleanup -= 1;
    if (this.callsUntilCleanup === 0) {
      this.cleanup(now);
      this.callsUntilCleanup = 256;
    }

    const current = this.windows.get(key);
    if (!current || now >= current.expiresAt) {
      this.windows.set(key, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (current.count >= limit) {
      return { allowed: false, retryAfterMs: current.expiresAt - now };
    }
    current.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  private cleanup(now: number): void {
    for (const [key, entry] of this.windows) {
      if (now >= entry.expiresAt) {
        this.windows.delete(key);
      }
    }
  }
}
