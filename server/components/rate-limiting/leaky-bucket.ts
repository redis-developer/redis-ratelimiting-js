import getClient from "../../redis.js";
import type { RateLimitResult } from "./fixed-window.js";

export interface LeakyBucketConfig {
  capacity: number;
  leakRate: number; // requests drained per second
  mode: "policing" | "shaping";
}

export const DEFAULT_CONFIG: LeakyBucketConfig = {
  capacity: 10,
  leakRate: 1,
  mode: "policing",
};

/**
 * Leaky Bucket rate limiter — supports two modes:
 *
 * Policing: bucket fills with requests and leaks at a constant rate.
 *   If the bucket is full the request is rejected immediately.
 *
 * Shaping: requests are queued and released at the leak rate.
 *   Each request is accepted with a delay indicating when it will
 *   be processed. Only rejected when the queue depth exceeds capacity.
 *
 * Redis commands: EVALSHA / EVAL (Lua), HSET, HGETALL
 */

const LUA_POLICING = `
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

return { allowed, remaining, 0 }
`;

const LUA_SHAPING = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local leak_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HGETALL', key)
local next_free = now

if #data > 0 then
  local fields = {}
  for i = 1, #data, 2 do
    fields[data[i]] = data[i + 1]
  end
  next_free = tonumber(fields['next_free']) or now
end

-- Can't schedule in the past
if next_free < now then
  next_free = now
end

local delay = next_free - now
local queue_depth = delay * leak_rate

local allowed = 0
local remaining = math.max(0, math.floor(capacity - queue_depth))
local delay_ms = 0

if queue_depth + 1 <= capacity then
  delay_ms = math.floor(delay * 1000)
  next_free = next_free + (1 / leak_rate)
  allowed = 1
  queue_depth = queue_depth + 1
  remaining = math.max(0, math.floor(capacity - queue_depth))
end

redis.call('HSET', key, 'next_free', tostring(next_free))
redis.call('EXPIRE', key, math.ceil(capacity / leak_rate) + 1)

return { allowed, remaining, delay_ms }
`;

export async function attempt(
  key: string,
  config: LeakyBucketConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { capacity, leakRate, mode } = config;

  const now = Date.now() / 1000;
  const script = mode === "shaping" ? LUA_SHAPING : LUA_POLICING;

  const result = (await redis.eval(script, {
    keys: [key],
    arguments: [capacity.toString(), leakRate.toString(), now.toString()],
  })) as number[];

  const allowed = result[0] === 1;
  const remaining = result[1];
  const delayMs = result[2] || 0;

  let retryAfter: number | null = null;
  if (!allowed) {
    retryAfter = Math.ceil(1 / leakRate);
  }

  return {
    allowed,
    remaining,
    limit: capacity,
    retryAfter,
    delay: delayMs > 0 ? delayMs / 1000 : null,
  };
}
