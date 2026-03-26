import { redis } from "../../redis.js";

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
 * A Lua script atomically increments the counter and sets
 * the expiry on the first request, preventing the key from
 * persisting forever if the process crashes mid-operation.
 *
 * Redis commands: EVAL (Lua), INCR, EXPIRE, PTTL
 */

const LUA_SCRIPT = `
local key = KEYS[1]
local max_requests = tonumber(ARGV[1])
local window_seconds = tonumber(ARGV[2])

local count = redis.call('INCR', key)

if count == 1 then
  redis.call('EXPIRE', key, window_seconds)
end

local pttl = redis.call('PTTL', key)

return { count, pttl }
`;

export async function attempt(
  key: string,
  config: FixedWindowConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const { maxRequests, windowSeconds } = config;

  const result = (await redis.eval(LUA_SCRIPT, {
    keys: [key],
    arguments: [maxRequests.toString(), windowSeconds.toString()],
  })) as number[];

  const count = result[0];
  const pttl = result[1];

  const allowed = count <= maxRequests;
  const remaining = Math.max(0, maxRequests - count);

  let retryAfter: number | null = null;
  if (!allowed) {
    retryAfter = pttl > 0 ? pttl / 1000 : windowSeconds;
  }

  return { allowed, remaining, limit: maxRequests, retryAfter };
}
