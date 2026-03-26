import "dotenv/config";
import { beforeAll, afterAll } from "bun:test";
import { $ } from "bun";

beforeAll(async () => {
  await $`docker compose up redis -d`;
});

afterAll(async () => {
  const { redis } = await import("./server/redis.js");
  await redis.close();

  await $`docker compose down redis`;
});
