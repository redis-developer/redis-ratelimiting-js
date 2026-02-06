import getClient from "../../redis.js";
import type { RateLimitResult } from "./fixed-window.js";

export interface SlidingWindowCounterConfig {
  maxRequests: number;
  windowSeconds: number;
}

export const DEFAULT_CONFIG: SlidingWindowCounterConfig = {
  maxRequests: 10,
  windowSeconds: 10,
};

/**
 * Sliding Window Counter rate limiter.
 *
 * Keeps two fixed-window counters (current and previous) and
 * computes a weighted count based on how far into the current
 * window we are. This smooths the boundary spike of plain
 * fixed windows while using very little memory (two keys).
 *
 * Redis commands: INCR, EXPIRE, GET, TTL
 */
export async function attempt(
  key: string,
  config: SlidingWindowCounterConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { maxRequests, windowSeconds } = config;

  const now = Math.floor(Date.now() / 1000);
  const currentWindow = Math.floor(now / windowSeconds);
  const previousWindow = currentWindow - 1;

  const currentKey = `${key}:${currentWindow}`;
  const previousKey = `${key}:${previousWindow}`;

  // How far through the current window (0..1)
  const elapsed = (now % windowSeconds) / windowSeconds;

  // Get previous window count
  const prevCount = parseInt((await redis.get(previousKey)) ?? "0", 10);
  // Weight by how much of the previous window still overlaps
  const weightedPrev = prevCount * (1 - elapsed);

  // Get current window count before incrementing
  const currentCount = parseInt((await redis.get(currentKey)) ?? "0", 10);

  const estimatedCount = weightedPrev + currentCount;

  if (estimatedCount >= maxRequests) {
    const retryAfter = Math.ceil(windowSeconds * (1 - elapsed));
    return {
      allowed: false,
      remaining: 0,
      limit: maxRequests,
      retryAfter: Math.max(1, retryAfter),
    };
  }

  // Allowed — increment current window
  const newCount = await redis.incr(currentKey);
  if (newCount === 1) {
    await redis.expire(currentKey, windowSeconds * 2);
  }

  const newEstimate = weightedPrev + newCount;
  const remaining = Math.max(0, Math.floor(maxRequests - newEstimate));

  return {
    allowed: true,
    remaining,
    limit: maxRequests,
    retryAfter: null,
  };
}
