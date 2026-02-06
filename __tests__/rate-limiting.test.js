import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import request from "supertest";
import app from "../server/app.js";
import getClient from "../server/redis.js";

const KEY_PREFIX = "ratelimit";

async function cleanup() {
  const redis = await getClient();
  const keys = await redis.keys(`${KEY_PREFIX}:*`);
  if (keys.length > 0) {
    await redis.del(keys);
  }
}

describe("Rate Limiting", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
  });

  describe("Fixed Window", () => {
    test("allows requests under the limit", async () => {
      const res = await request(app)
        .post("/api/rate-limit/fixed-window")
        .expect(200);

      expect(res.text).toContain("Allowed");
      expect(res.text).toContain("9 / 10 remaining");
    });

    test("denies requests over the limit", async () => {
      // Send 10 requests to fill the window
      for (let i = 0; i < 10; i++) {
        await request(app).post("/api/rate-limit/fixed-window");
      }

      const res = await request(app)
        .post("/api/rate-limit/fixed-window")
        .expect(200);

      expect(res.text).toContain("Denied");
      expect(res.text).toContain("0 / 10 remaining");
    });

    test("burst sends 10 requests and shows results", async () => {
      const res = await request(app)
        .post("/api/rate-limit/fixed-window/burst")
        .expect(200);

      expect(res.text).toContain("Allowed");
      expect(res.text).toContain("0 / 10 remaining");
    });
  });

  describe("Sliding Window Log", () => {
    test("allows requests under the limit", async () => {
      const res = await request(app)
        .post("/api/rate-limit/sliding-window-log")
        .expect(200);

      expect(res.text).toContain("Allowed");
      expect(res.text).toContain("9 / 10 remaining");
    });

    test("denies requests over the limit", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post("/api/rate-limit/sliding-window-log");
      }

      const res = await request(app)
        .post("/api/rate-limit/sliding-window-log")
        .expect(200);

      expect(res.text).toContain("Denied");
      expect(res.text).toContain("0 / 10 remaining");
    });
  });

  describe("Sliding Window Counter", () => {
    test("allows requests under the limit", async () => {
      const res = await request(app)
        .post("/api/rate-limit/sliding-window-counter")
        .expect(200);

      expect(res.text).toContain("Allowed");
    });

    test("denies requests over the limit", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post("/api/rate-limit/sliding-window-counter");
      }

      const res = await request(app)
        .post("/api/rate-limit/sliding-window-counter")
        .expect(200);

      expect(res.text).toContain("Denied");
    });
  });

  describe("Token Bucket", () => {
    test("allows requests when tokens are available", async () => {
      const res = await request(app)
        .post("/api/rate-limit/token-bucket")
        .expect(200);

      expect(res.text).toContain("Allowed");
    });

    test("denies requests when bucket is empty", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post("/api/rate-limit/token-bucket");
      }

      const res = await request(app)
        .post("/api/rate-limit/token-bucket")
        .expect(200);

      expect(res.text).toContain("Denied");
      expect(res.text).toContain("0 / 10 remaining");
    });
  });

  describe("Leaky Bucket", () => {
    test("allows requests when bucket has capacity", async () => {
      const res = await request(app)
        .post("/api/rate-limit/leaky-bucket")
        .expect(200);

      expect(res.text).toContain("Allowed");
    });

    test("denies requests when bucket is full", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).post("/api/rate-limit/leaky-bucket");
      }

      const res = await request(app)
        .post("/api/rate-limit/leaky-bucket")
        .expect(200);

      expect(res.text).toContain("Denied");
      expect(res.text).toContain("0 / 10 remaining");
    });
  });

  describe("Reset", () => {
    test("clears all rate limit keys", async () => {
      // Create some state
      await request(app).post("/api/rate-limit/fixed-window");
      await request(app).post("/api/rate-limit/token-bucket");

      // Reset
      await request(app).post("/api/rate-limit/reset").expect(200);

      // Verify counters are reset by checking we get full remaining
      const res = await request(app)
        .post("/api/rate-limit/fixed-window")
        .expect(200);

      expect(res.text).toContain("9 / 10 remaining");
    });
  });

  describe("Unknown algorithm", () => {
    test("returns 400 for unknown algorithm", async () => {
      await request(app)
        .post("/api/rate-limit/unknown-algo")
        .expect(400);
    });
  });
});
