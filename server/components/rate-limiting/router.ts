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

const algorithms: Record<
  string,
  { attempt: (key: string) => Promise<RateLimitResult>; limit: number }
> = {
  "fixed-window": {
    attempt: (key) => fixedWindow.attempt(key),
    limit: fixedWindow.DEFAULT_CONFIG.maxRequests,
  },
  "sliding-window-log": {
    attempt: (key) => slidingWindowLog.attempt(key),
    limit: slidingWindowLog.DEFAULT_CONFIG.maxRequests,
  },
  "sliding-window-counter": {
    attempt: (key) => slidingWindowCounter.attempt(key),
    limit: slidingWindowCounter.DEFAULT_CONFIG.maxRequests,
  },
  "token-bucket": {
    attempt: (key) => tokenBucket.attempt(key),
    limit: tokenBucket.DEFAULT_CONFIG.maxTokens,
  },
  "leaky-bucket": {
    attempt: (key) => leakyBucket.attempt(key),
    limit: leakyBucket.DEFAULT_CONFIG.capacity,
  },
};

function buildResultHtml(results: RateLimitResult[]): string {
  const items = results
    .map((r) => {
      const percent = Math.round((r.remaining / r.limit) * 100);
      let barColor = "bg-emerald-500";
      if (percent <= 20) barColor = "bg-red-500";
      else if (percent <= 50) barColor = "bg-yellow-500";

      const icon = r.allowed
        ? `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`
        : `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>`;

      const statusClass = r.allowed ? "text-emerald-400" : "text-red-400";
      const statusText = r.allowed ? "Allowed" : "Denied";

      const retryHtml =
        r.retryAfter !== null
          ? `<p class="text-xs text-gray-500 mt-1">Retry after ${r.retryAfter}s</p>`
          : "";

      return `<div class="mb-2 last:mb-0">
  <div class="flex items-center justify-between mb-1">
    <span class="inline-flex items-center gap-1 text-sm font-medium ${statusClass}">${icon} ${statusText}</span>
    <span class="text-xs text-gray-500">${r.remaining} / ${r.limit} remaining</span>
  </div>
  <div class="w-full bg-gray-800 rounded-full h-2">
    <div class="h-2 rounded-full transition-all duration-300 ${barColor}" style="width: ${percent}%"></div>
  </div>
  ${retryHtml}
</div>`;
    })
    .join("\n");

  return items;
}

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

    res.send("");
  } catch (err) {
    console.error(err);
    res.status(500).send(`<p class="text-red-400 text-sm">Error: ${err}</p>`);
  }
});

/**
 * POST /api/rate-limit/:algorithm
 * Single request attempt
 */
router.post("/:algorithm", async (req: Request, res: Response) => {
  const { algorithm } = req.params;
  const algo = algorithms[algorithm];

  if (!algo) {
    res.status(400).send(`<p class="text-red-400 text-sm">Unknown algorithm: ${algorithm}</p>`);
    return;
  }

  try {
    const key = `${KEY_PREFIX}:${algorithm}`;
    const result = await algo.attempt(key);
    const html = buildResultHtml([result]);
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send(`<p class="text-red-400 text-sm">Error: ${err}</p>`);
  }
});

/**
 * POST /api/rate-limit/:algorithm/burst
 * Send 10 rapid requests and show all results
 */
router.post("/:algorithm/burst", async (req: Request, res: Response) => {
  const { algorithm } = req.params;
  const algo = algorithms[algorithm];

  if (!algo) {
    res.status(400).send(`<p class="text-red-400 text-sm">Unknown algorithm: ${algorithm}</p>`);
    return;
  }

  try {
    const key = `${KEY_PREFIX}:${algorithm}`;
    const results: RateLimitResult[] = [];

    for (let i = 0; i < 10; i++) {
      results.push(await algo.attempt(key));
    }

    const html = buildResultHtml(results);
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send(`<p class="text-red-400 text-sm">Error: ${err}</p>`);
  }
});
