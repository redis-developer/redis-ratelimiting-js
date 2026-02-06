import getClient from "../../redis.js";
import type { RateLimitResult } from "./fixed-window.js";

export interface TokenBucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
}

export const DEFAULT_CONFIG: TokenBucketConfig = {
  maxTokens: 10,
  refillRate: 1,
};

/**
 * Token Bucket rate limiter.
 *
 * Stores tokens and last-refill timestamp in a HASH.
 * A Lua script atomically calculates how many tokens to add
 * since the last refill, then tries to consume one token.
 *
 * Redis commands: EVALSHA / EVAL (Lua), HSET, HGETALL
 */

const LUA_SCRIPT = `
local key = KEYS[1]
local max_tokens = tonumber(ARGV[1])
local refill_rate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HGETALL', key)
local tokens = max_tokens
local last_refill = now

if #data > 0 then
  local fields = {}
  for i = 1, #data, 2 do
    fields[data[i]] = data[i + 1]
  end
  tokens = tonumber(fields['tokens']) or max_tokens
  last_refill = tonumber(fields['last_refill']) or now
end

-- Refill tokens based on elapsed time
local elapsed = now - last_refill
local new_tokens = elapsed * refill_rate
tokens = math.min(max_tokens, tokens + new_tokens)

local allowed = 0
local remaining = tokens

if tokens >= 1 then
  tokens = tokens - 1
  remaining = tokens
  allowed = 1
end

redis.call('HSET', key, 'tokens', tostring(tokens), 'last_refill', tostring(now))
redis.call('EXPIRE', key, math.ceil(max_tokens / refill_rate) + 1)

return { allowed, math.floor(remaining) }
`;

export async function attempt(
  key: string,
  config: TokenBucketConfig = DEFAULT_CONFIG,
): Promise<RateLimitResult> {
  const redis = await getClient();
  const { maxTokens, refillRate } = config;

  const now = Date.now() / 1000; // seconds with fractional precision

  const result = (await redis.eval(LUA_SCRIPT, {
    keys: [key],
    arguments: [maxTokens.toString(), refillRate.toString(), now.toString()],
  })) as number[];

  const allowed = result[0] === 1;
  const remaining = result[1];

  let retryAfter: number | null = null;
  if (!allowed) {
    retryAfter = Math.ceil(1 / refillRate);
  }

  return { allowed, remaining, limit: maxTokens, retryAfter };
}
