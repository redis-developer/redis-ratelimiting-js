import express from "express";
import type { Request, Response } from "express";
import getClient from "../../redis.js";
import * as fixedWindow from "./fixed-window.js";
import * as slidingWindowLog from "./sliding-window-log.js";
import * as slidingWindowCounter from "./sliding-window-counter.js";
import * as tokenBucket from "./token-bucket.js";
import * as leakyBucket from "./leaky-bucket.js";
import type { RateLimitResult } from "./fixed-window.js";

export const router = express.Router();

const KEY_PREFIX = "ratelimit";

interface ConfigField {
  name: string;
  label: string;
  default: number;
  min: number;
  max: number;
  step: number;
}

interface AlgorithmMeta {
  name: string;
  slug: string;
  description: string;
  redisType: string;
  commands: string;
  shortDesc: string;
  infoUrl: string;
  configFields: ConfigField[];
}

const algorithmMeta: Record<string, AlgorithmMeta> = {
  "fixed-window": {
    name: "Fixed Window Counter",
    slug: "fixed-window",
    description:
      "Counts requests in fixed time windows using INCR + EXPIRE. Simple but susceptible to boundary bursts.",
    redisType: "STRING",
    commands: "INCR, EXPIRE, TTL",
    shortDesc: "Fixed time intervals",
    infoUrl: "https://redis.io/tutorials/howtos/ratelimiting/#1-fixed-window-counter",
    configFields: [
      { name: "maxRequests", label: "Max Requests", default: 10, min: 1, max: 50, step: 1 },
      { name: "windowSeconds", label: "Window (seconds)", default: 10, min: 1, max: 60, step: 1 },
    ],
  },
  "sliding-window-log": {
    name: "Sliding Window Log",
    slug: "sliding-window-log",
    description:
      "Logs each request timestamp in a ZSET. Precise sliding window, but stores every request.",
    redisType: "SORTED SET",
    commands: "ZADD, ZREMRANGEBYSCORE, ZCARD",
    shortDesc: "Exact timestamp tracking",
    infoUrl: "https://redis.io/tutorials/howtos/ratelimiting/#2-sliding-window-log",
    configFields: [
      { name: "maxRequests", label: "Max Requests", default: 10, min: 1, max: 50, step: 1 },
      { name: "windowSeconds", label: "Window (seconds)", default: 10, min: 1, max: 60, step: 1 },
    ],
  },
  "sliding-window-counter": {
    name: "Sliding Window Counter",
    slug: "sliding-window-counter",
    description:
      "Weighted average of current and previous window counts. Smooths the fixed-window boundary problem with minimal memory.",
    redisType: "STRING x2",
    commands: "INCR, EXPIRE, GET",
    shortDesc: "Weighted window blending",
    infoUrl: "https://redis.io/tutorials/howtos/ratelimiting/#3-sliding-window-counter",
    configFields: [
      { name: "maxRequests", label: "Max Requests", default: 10, min: 1, max: 50, step: 1 },
      { name: "windowSeconds", label: "Window (seconds)", default: 10, min: 1, max: 60, step: 1 },
    ],
  },
  "token-bucket": {
    name: "Token Bucket",
    slug: "token-bucket",
    description:
      "Tokens refill at a steady rate; each request consumes one. Allows short bursts up to bucket capacity. Uses a HASH + Lua script.",
    redisType: "HASH + Lua",
    commands: "EVAL, HSET, HGETALL",
    shortDesc: "Steady refill, burst-friendly",
    infoUrl: "https://redis.io/tutorials/howtos/ratelimiting/#4-token-bucket",
    configFields: [
      { name: "maxTokens", label: "Max Tokens", default: 10, min: 1, max: 50, step: 1 },
      { name: "refillRate", label: "Refill Rate (tok/s)", default: 1, min: 0.1, max: 10, step: 0.1 },
    ],
  },
  "leaky-bucket": {
    name: "Leaky Bucket",
    slug: "leaky-bucket",
    description:
      "Requests fill a bucket that leaks at a constant rate. Drops requests when the bucket is full (policing method). Uses a HASH + Lua script.",
    redisType: "HASH + Lua",
    commands: "EVAL, HSET, HGETALL",
    shortDesc: "Constant drain rate",
    infoUrl: "https://redis.io/tutorials/howtos/ratelimiting/#5-leaky-bucket",
    configFields: [
      { name: "capacity", label: "Capacity", default: 10, min: 1, max: 50, step: 1 },
      { name: "leakRate", label: "Leak Rate (req/s)", default: 1, min: 0.1, max: 10, step: 0.1 },
    ],
  },
};

const algorithms: Record<
  string,
  {
    attempt: (key: string, config?: any) => Promise<RateLimitResult>;
    defaultConfig: Record<string, any>;
  }
> = {
  "fixed-window": {
    attempt: (key, config) => fixedWindow.attempt(key, config),
    defaultConfig: { ...fixedWindow.DEFAULT_CONFIG },
  },
  "sliding-window-log": {
    attempt: (key, config) => slidingWindowLog.attempt(key, config),
    defaultConfig: { ...slidingWindowLog.DEFAULT_CONFIG },
  },
  "sliding-window-counter": {
    attempt: (key, config) => slidingWindowCounter.attempt(key, config),
    defaultConfig: { ...slidingWindowCounter.DEFAULT_CONFIG },
  },
  "token-bucket": {
    attempt: (key, config) => tokenBucket.attempt(key, config),
    defaultConfig: { ...tokenBucket.DEFAULT_CONFIG },
  },
  "leaky-bucket": {
    attempt: (key, config) => leakyBucket.attempt(key, config),
    defaultConfig: { ...leakyBucket.DEFAULT_CONFIG },
  },
};

/**
 * GET /api/rate-limit/:algorithm/view
 * Returns an HTML fragment for the algorithm's interactive UI (used by HTMX)
 */
router.get("/:algorithm/view", (req: Request, res: Response) => {
  const { algorithm } = req.params;
  const meta = algorithmMeta[algorithm];

  if (!meta) {
    res.status(404).send(`<p class="text-red-400 text-sm">Unknown algorithm: ${algorithm}</p>`);
    return;
  }

  const configJson = JSON.stringify(
    Object.fromEntries(meta.configFields.map((f) => [f.name, f.default])),
  );

  res.render("algorithm-view", { layout: false, ...meta, configJson });
});

/**
 * POST /api/rate-limit/reset
 * Delete all rate-limit keys
 */
router.post("/reset", async (_req: Request, res: Response) => {
  try {
    const redis = await getClient();
    const keys = await redis.keys(`${KEY_PREFIX}:*`);

    if (keys.length > 0) {
      await redis.del(keys);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/rate-limit/:algorithm
 * Single request attempt. Accepts optional { config } in body.
 */
router.post("/:algorithm", async (req: Request, res: Response) => {
  const { algorithm } = req.params;
  const algo = algorithms[algorithm];

  if (!algo) {
    res.status(400).json({ error: `Unknown algorithm: ${algorithm}` });
    return;
  }

  try {
    const key = `${KEY_PREFIX}:${algorithm}`;
    const config = req.body?.config
      ? { ...algo.defaultConfig, ...req.body.config }
      : undefined;
    const result = await algo.attempt(key, config);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

/**
 * POST /api/rate-limit/:algorithm/burst
 * Send multiple rapid requests. Accepts { config, count } in body.
 */
router.post("/:algorithm/burst", async (req: Request, res: Response) => {
  const { algorithm } = req.params;
  const algo = algorithms[algorithm];

  if (!algo) {
    res.status(400).json({ error: `Unknown algorithm: ${algorithm}` });
    return;
  }

  try {
    const key = `${KEY_PREFIX}:${algorithm}`;
    const config = req.body?.config
      ? { ...algo.defaultConfig, ...req.body.config }
      : undefined;
    const count = Math.min(Math.max(parseInt(req.body?.count) || 10, 1), 50);
    const results: RateLimitResult[] = [];

    for (let i = 0; i < count; i++) {
      results.push(await algo.attempt(key, config));
    }

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});
