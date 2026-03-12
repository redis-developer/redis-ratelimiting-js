import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import request from "supertest";
import app from "../server/app.js";
import getClient from "../server/redis.js";

const KEY_PREFIX = "ratelimit";

async function cleanup() {
  const redis = await getClient();
  const keys = await redis.keys(`${KEY_PREFIX}:*`);
  const hashTaggedKeys = await redis.keys(`{${KEY_PREFIX}:*`);
  const allKeys = [...keys, ...hashTaggedKeys];
  if (allKeys.length > 0) {
    await redis.del(allKeys);
  }
}

describe("Rate Limiting", () => {
  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    // await cleanup();
  });

  describe("Fixed Window", () => {
    test("allows requests under the limit", async () => {
      const agent = request.agent(app);
      const { body } = await agent
        .post("/api/rate-limit/fixed-window")
        .expect(200);

      expect(body.allowed).toBeTrue();
      expect(body.remaining).toBe(9);
      expect(body.limit).toBe(10);
    });

    test("denies requests over the limit", async () => {
      const agent = request.agent(app);

      for (let i = 0; i < 10; i++) {
        await agent.post("/api/rate-limit/fixed-window");
      }

      const { body } = await agent
        .post("/api/rate-limit/fixed-window")
        .expect(200);

      expect(body.allowed).toBeFalse();
      expect(body.remaining).toBe(0);
      expect(body.limit).toBe(10);
    });

    test("burst sends 10 requests and shows results", async () => {
      const agent = request.agent(app);
      const { body } = await agent
        .post("/api/rate-limit/fixed-window/burst")
        .expect(200);

      for (let i = 0; i < 10; ++i) {
        expect(body[i].allowed).toBeTrue();
        expect(body[i].remaining).toBe(9 - i);
        expect(body[i].limit).toBe(10);
      }
    });
  });

  describe("Sliding Window Log", () => {
    test("allows requests under the limit", async () => {
      const agent = request.agent(app);
      const { body } = await agent
        .post("/api/rate-limit/sliding-window-log")
        .expect(200);

      expect(body.allowed).toBeTrue();
      expect(body.remaining).toBe(9);
      expect(body.limit).toBe(10);
    });

    test("denies requests over the limit", async () => {
      const agent = request.agent(app);

      for (let i = 0; i < 10; i++) {
        await agent.post("/api/rate-limit/sliding-window-log");
      }

      const { body } = await agent
        .post("/api/rate-limit/sliding-window-log")
        .expect(200);

      expect(body.allowed).toBeFalse();
      expect(body.remaining).toBe(0);
      expect(body.limit).toBe(10);
    });
  });

  describe("Sliding Window Counter", () => {
    test("allows requests under the limit", async () => {
      const agent = request.agent(app);
      const { body } = await agent
        .post("/api/rate-limit/sliding-window-counter")
        .expect(200);

      expect(body.allowed).toBeTrue();
      expect(body.limit).toBe(10);
    });

    test("denies requests over the limit", async () => {
      const agent = request.agent(app);

      for (let i = 0; i < 10; i++) {
        await agent.post("/api/rate-limit/sliding-window-counter");
      }

      const { body } = await agent
        .post("/api/rate-limit/sliding-window-counter")
        .expect(200);

      expect(body.allowed).toBeFalse();
      expect(body.limit).toBe(10);
    });
  });

  describe("Token Bucket", () => {
    test("allows requests when tokens are available", async () => {
      const agent = request.agent(app);
      const { body } = await agent
        .post("/api/rate-limit/token-bucket")
        .expect(200);

      expect(body.allowed).toBeTrue();
      expect(body.limit).toBe(10);
    });

    test("denies requests when bucket is empty", async () => {
      const agent = request.agent(app);

      for (let i = 0; i < 10; i++) {
        await agent.post("/api/rate-limit/token-bucket");
      }

      const { body } = await agent
        .post("/api/rate-limit/token-bucket")
        .expect(200);

      expect(body.allowed).toBeFalse();
      expect(body.remaining).toBe(0);
      expect(body.limit).toBe(10);
    });
  });

  describe("Leaky Bucket", () => {
    test("allows requests when bucket has capacity", async () => {
      const agent = request.agent(app);
      const { body } = await agent
        .post("/api/rate-limit/leaky-bucket")
        .expect(200);

      expect(body.allowed).toBeTrue();
      expect(body.limit).toBe(10);
    });

    test("denies requests when bucket is full", async () => {
      const agent = request.agent(app);

      for (let i = 0; i < 10; i++) {
        await agent.post("/api/rate-limit/leaky-bucket");
      }

      const { body } = await agent
        .post("/api/rate-limit/leaky-bucket")
        .expect(200);

      expect(body.allowed).toBeFalse();
      expect(body.remaining).toBe(0);
      expect(body.limit).toBe(10);
    });
  });

  describe("Reset", () => {
    test("clears all rate limit keys", async () => {
      const agent = request.agent(app);

      await agent.post("/api/rate-limit/fixed-window");
      await agent.post("/api/rate-limit/token-bucket");

      await agent.post("/api/rate-limit/reset").expect(200);

      const { body } = await agent
        .post("/api/rate-limit/fixed-window")
        .expect(200);

      expect(body.remaining).toBe(9);
      expect(body.limit).toBe(10);
    });
  });

  describe("Unknown algorithm", () => {
    test("returns 400 for unknown algorithm", async () => {
      await request(app).post("/api/rate-limit/unknown-algo").expect(400);
    });
  });
});
