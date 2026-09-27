import Redis from 'ioredis';
import type { Clock } from '../time/clock';

export interface HitResult {
  count: number;
  /** ms until the current window ends. */
  resetMs: number;
}

/**
 * Fixed-window counters. One window per (key, windowMs); the counter is
 * incremented on every hit and expires with its window.
 */
export abstract class RateLimiter {
  abstract hit(key: string, windowMs: number): Promise<HitResult>;
  abstract close(): Promise<void>;
}

function windowOf(now: number, windowMs: number) {
  const index = Math.floor(now / windowMs);
  return { index, resetMs: (index + 1) * windowMs - now };
}

/** Shared by every API replica. INCR + PEXPIRE run atomically in one script. */
export class RedisRateLimiter extends RateLimiter {
  private static readonly SCRIPT = `local n = redis.call('INCR', KEYS[1]) if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return n`;
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly clock: Clock
  ) {
    super();
    // Fail fast instead of queueing: a slow limiter must not slow down the API.
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 2000, lazyConnect: false });
    this.redis.on('error', () => undefined); // surfaced per call; avoid unhandled error events
  }

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const { index, resetMs } = windowOf(this.clock.now().getTime(), windowMs);
    const count = Number(await this.redis.eval(RedisRateLimiter.SCRIPT, 1, `rl:${key}:${windowMs}:${index}`, String(windowMs + 1000)));
    return { count, resetMs };
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

/** Single-process development / tests. Not for more than one replica. */
export class MemoryRateLimiter extends RateLimiter {
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly clock: Clock) {
    super();
  }

  async hit(key: string, windowMs: number): Promise<HitResult> {
    const now = this.clock.now().getTime();
    const { index, resetMs } = windowOf(now, windowMs);
    const k = `${key}:${windowMs}:${index}`;
    const entry = this.counters.get(k);
    const count = entry && entry.expiresAt > now ? entry.count + 1 : 1;
    this.counters.set(k, { count, expiresAt: now + resetMs });
    if (this.counters.size > 10_000) for (const [key2, v] of this.counters) if (v.expiresAt <= now) this.counters.delete(key2);
    return { count, resetMs };
  }

  async close(): Promise<void> {
    this.counters.clear();
  }
}
