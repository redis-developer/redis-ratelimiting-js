import getClient from "../../redis.js";
import type { RateLimitResult } from "./fixed-window.js";

export interface LeakyBucketConfig {
  capacity: number;
  leakRate: number; // requests drained per second
}

export const DEFAULT_CONFIG: LeakyBucketConfig = {
  capacity: 10,
  leakRate: 1,
};

/**
 * Leaky Bucket rate limiter.
 *
 * The bucket fills with incoming requests and leaks (drains)
 * at a constant rate. If the bucket is full the request is
 * rejected. Stored in a HASH with level + last_leak timestamp.
 *
 * Redis commands: EVALSHA / EVAL (Lua), HSET, HGETALL
 */

const LUA_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local leak_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HGETALL', key)
local level = 0
local last_leak = now

if #data > 0 then
  local fields = {}
  for i = 1, #data, 2 do
    fields[data[i]] = data[i + 1]
  end
  level = tonumber(fields['level']) or 0
  last_leak = tonumber(fields['last_leak']) or now
end

-- Drain based on elapsed time
local elapsed = now - last_leak
local leaked = elapsed * leak_rate
level = math.max(0, level - leaked)

local allowed = 0
local remaining = math.max(0, math.floor(capacity - level))

if level + 1 <= capacity then
  level = level + 1
  remaining = math.max(0, math.floor(capacity - level))
  allowed = 1
end

redis.call('HSET', key, 'level', tostring(level), 'last_leak', tostring(now))
redis.call('EXPIRE', key, math.ceil(capacity / leak_rate) + 1)

return { allowed, remaining }
`;

export async function attempt(
  key: string,
  config: LeakyBucketConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { capacity, leakRate } = config;

  const now = Date.now() / 1000;

  const result = (await redis.eval(LUA_SCRIPT, {
    keys: [key],
    arguments: [capacity.toString(), leakRate.toString(), now.toString()],
  })) as number[];

  const allowed = result[0] === 1;
  const remaining = result[1];

  let retryAfter: number | null = null;
  if (!allowed) {
    retryAfter = Math.ceil(1 / leakRate);
  }

  return { allowed, remaining, limit: capacity, retryAfter };
}
