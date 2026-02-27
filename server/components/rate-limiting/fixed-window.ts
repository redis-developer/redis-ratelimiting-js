import getClient from "../../redis.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfter: number | null;
  delay?: number | null;
}

export interface FixedWindowConfig {
  maxRequests: number;
  windowSeconds: number;
}

export const DEFAULT_CONFIG: FixedWindowConfig = {
  maxRequests: 10,
  windowSeconds: 10,
};

/**
 * Fixed Window Counter rate limiter.
 *
 * Uses a single STRING key per window. 
 * INCR atomically bumps the counter, and EXPIRE ensures
 * cleanup.
 *
 * Redis commands: INCR, EXPIRE, TTL
 */
export async function attempt(
  key: string,
  config: FixedWindowConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { maxRequests, windowSeconds } = config;

  const count = await redis.incr(key);

  // Set expiry on first request in this window
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  const allowed = count <= maxRequests;
  const remaining = Math.max(0, maxRequests - count);

  let retryAfter: number | null = null;
  if (!allowed) {
    // Use pTTL to get milliseconds
    const ttl = (await redis.pTTL(key)) / 1000;
    retryAfter = ttl > 0 ? ttl : windowSeconds;
  }

  return { allowed, remaining, limit: maxRequests, retryAfter };
}
