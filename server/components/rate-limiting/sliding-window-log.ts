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
 * A Lua script atomically prunes expired entries, checks the
 * count, and conditionally adds the new entry — preventing
 * concurrent requests from both slipping past the limit.
 *
 * Redis commands: EVAL (Lua), ZREMRANGEBYSCORE, ZADD, ZCARD, ZRANGE, EXPIRE
 */

const LUA_SCRIPT = `
local key = KEYS[1]
local max_requests = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]

local window_start = now - window_seconds * 1000

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)

local count = redis.call('ZCARD', key)

if count < max_requests then
  redis.call('ZADD', key, now, member)
  redis.call('EXPIRE', key, window_seconds)
  return { 1, max_requests - count - 1, 0 }
end

-- Denied: find oldest entry to compute retry-after (in ms)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local retry_after_ms = window_seconds * 1000
if #oldest >= 2 then
  retry_after_ms = oldest[2] + window_seconds * 1000 - now
end

return { 0, 0, retry_after_ms }
`;

export async function attempt(
  key: string,
  config: SlidingWindowLogConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { maxRequests, windowSeconds } = config;

  const now = Date.now();
  const member = `${now}:${Math.random()}`;

  const result = (await redis.eval(LUA_SCRIPT, {
    keys: [key],
    arguments: [
      maxRequests.toString(),
      windowSeconds.toString(),
      now.toString(),
      member,
    ],
  })) as number[];

  const allowed = result[0] === 1;
  const remaining = result[1];
  const retryAfterMs = result[2];

  return {
    allowed,
    remaining,
    limit: maxRequests,
    retryAfter: allowed ? null : Math.max(0, retryAfterMs / 1000),
  };
}
