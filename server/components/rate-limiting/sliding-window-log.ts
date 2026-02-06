import getClient from "../../redis.js";
import type { RateLimitResult } from "./fixed-window.js";

export interface SlidingWindowLogConfig {
  maxRequests: number;
  windowSeconds: number;
}

export const DEFAULT_CONFIG: SlidingWindowLogConfig = {
  maxRequests: 10,
  windowSeconds: 10,
};

/**
 * Sliding Window Log rate limiter.
 *
 * Stores each request timestamp as a member in a SORTED SET.
 * On every attempt we remove entries older than the window,
 * then count the remaining entries.
 *
 * Redis commands: ZREMRANGEBYSCORE, ZADD, ZCARD, EXPIRE
 */
export async function attempt(
  key: string,
  config: SlidingWindowLogConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { maxRequests, windowSeconds } = config;

  const now = Date.now();
  const windowStart = now - windowSeconds * 1000;

  // Remove entries outside the window
  await redis.zRemRangeByScore(key, 0, windowStart);

  // Count current entries
  const count = await redis.zCard(key);

  if (count < maxRequests) {
    // Add this request with timestamp as score and a unique member
    await redis.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
    await redis.expire(key, windowSeconds);

    return {
      allowed: true,
      remaining: maxRequests - count - 1,
      limit: maxRequests,
      retryAfter: null,
    };
  }

  // Denied — find the oldest entry to compute retry-after
  const oldest = await redis.zRangeWithScores(key, 0, 0);
  let retryAfter = windowSeconds;
  if (oldest.length > 0) {
    retryAfter = Math.ceil((oldest[0].score + windowSeconds * 1000 - now) / 1000);
    retryAfter = Math.max(1, retryAfter);
  }

  return {
    allowed: false,
    remaining: 0,
    limit: maxRequests,
    retryAfter,
  };
}
