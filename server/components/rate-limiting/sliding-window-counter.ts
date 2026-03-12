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
 * window we are. A Lua script atomically reads both counters,
 * evaluates the weighted estimate, and conditionally increments
 * — preventing concurrent requests from slipping past the limit.
 *
 * Keys use hash tags (`{base}:window`) so both counters map to
 * the same slot in Redis Cluster.
 *
 * Redis commands: EVAL (Lua), GET, INCR, EXPIRE
 */

const LUA_SCRIPT = `
local current_key = KEYS[1]
local previous_key = KEYS[2]
local max_requests = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])

local prev_count = tonumber(redis.call('GET', previous_key) or '0') or 0
local current_count = tonumber(redis.call('GET', current_key) or '0') or 0

local weighted_prev = prev_count * (1 - elapsed)
local estimated = weighted_prev + current_count

if estimated >= max_requests then
  return { 0, 0, math.floor(current_count) }
end

local new_count = redis.call('INCR', current_key)

if new_count == 1 then
  redis.call('EXPIRE', current_key, window_seconds * 2)
end

local new_estimate = weighted_prev + new_count
local remaining = math.max(0, math.floor(max_requests - new_estimate))

return { 1, remaining, new_count }
`;

export async function attempt(
  key: string,
  config: SlidingWindowCounterConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { maxRequests, windowSeconds } = config;

  const now = Math.floor(Date.now() / 1000);
  const currentWindow = Math.floor(now / windowSeconds);
  const previousWindow = currentWindow - 1;

  // Hash tags ensure both keys map to the same cluster slot
  const currentKey = `{${key}}:${currentWindow}`;
  const previousKey = `{${key}}:${previousWindow}`;

  const elapsed = (now % windowSeconds) / windowSeconds;

  const result = (await redis.eval(LUA_SCRIPT, {
    keys: [currentKey, previousKey],
    arguments: [
      maxRequests.toString(),
      windowSeconds.toString(),
      elapsed.toString(),
    ],
  })) as number[];

  const allowed = result[0] === 1;
  const remaining = result[1];

  let retryAfter: number | null = null;
  if (!allowed) {
    retryAfter = Math.max(1, Math.ceil(windowSeconds * (1 - elapsed)));
  }

  return {
    allowed,
    remaining,
    limit: maxRequests,
    retryAfter,
  };
}
