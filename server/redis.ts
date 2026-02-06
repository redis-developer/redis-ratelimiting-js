import { createClient } from "redis";
import type {
  RedisClientOptions,
  RedisClientType,
  RedisDefaultModules,
} from "redis";

if (!process.env.REDIS_URL) {
  console.error("REDIS_URL not set");
}

export type RedisClient = RedisClientType<RedisDefaultModules, {}, {}, 2, {}>;

let clients: Record<string, Promise<RedisClient>> = {};
let retries: Record<string, number> = {};

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function getClient(
  options?: RedisClientOptions,
): Promise<RedisClient> {
  options = Object.assign(
    {},
    {
      url: process.env.REDIS_URL,
    },
    options,
  );

  if (!options.url) {
    throw new Error("You must pass a URL to connect");
  }

  const clientPromise = clients[options.url];

  if (clientPromise) {
    return clientPromise;
  }

  try {
    const client = createClient(options) as RedisClient;

    client.on("error", async (err) => {
      const url = options.url ?? "";

      console.error("Redis Client Error");
      console.error(err);

      try {
        client.destroy();
        await client.close();
      } catch (err) {}

      const clientRetries = retries[url] ?? 0;
      retries[url] = clientRetries + 1;
      try {
        // Exponential backoff with jitter
        await wait(2 ** ((clientRetries % 10) + 1) * 10);
        console.log(
          `${clientRetries} connection failures, reconnecting to Redis...`,
        );
        await refreshClient(client);
      } catch (e) {}
    });

    clients[options.url] = new Promise(async (resolve) => {
      await client.connect();

      resolve(client);
    });

    return clients[options.url];
  } catch (err) {
    console.error("Error creating Redis client:");
    console.error(err);

    throw err;
  }
}

async function refreshClient(client: RedisClient) {
  if (client) {
    const options = client.options;

    if (options?.url) {
      delete clients[options?.url];
    }

    await getClient(options);
  }
}
