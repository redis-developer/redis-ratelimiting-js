This is a [Redis](https://redis.io/) rate limiting demo for JS and [Node](https://nodejs.org/) using:

- [Redis Cloud](https://redis.io/try-free/)
- [Express](https://expressjs.com/)
- [Handlebars](https://handlebarsjs.com/) + [HTMX](https://htmx.org/)

> **NOTE:** Read the [tutorial on rate limiters](https://redis.io/tutorials/howtos/ratelimiting/) for a guide.

## Rate Limiting Algorithms

This demo implements five rate limiting algorithms, each backed by different Redis data structures:

| Algorithm                  | Redis Data Structure                       | Description                                                                                                                                           |
| -------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fixed Window Counter**   | `STRING` (`INCR` + `EXPIRE`)               | Counts requests in fixed time windows. Simple but susceptible to boundary bursts.                                                                     |
| **Sliding Window Log**     | `SORTED SET` (`ZADD` + `ZREMRANGEBYSCORE`) | Logs each request timestamp. Precise sliding window, but stores every request.                                                                        |
| **Sliding Window Counter** | `STRING` x2 (weighted)                     | Weighted average of current and previous window counts. Smooths the fixed-window boundary problem.                                                    |
| **Token Bucket**           | `HASH` + Lua script                        | Tokens refill at a steady rate; each request consumes one. Allows short bursts.                                                                       |
| **Leaky Bucket**           | `HASH` + Lua script                        | Requests fill a bucket that leaks at a constant rate. Smooths traffic to steady output (shaping), or drops requests above the bucket size (policing). |

## Requirements

- [bun](https://bun.sh/)
- [docker](https://www.docker.com/)
  - Optional

## Getting started

Copy and edit the `.env` file:

```bash
cp .env.example .env
```

Your `.env` file should contain the connection string you copied from Redis Cloud.

Your `.env.docker` file will look similar to `.env`, but should use the appropriate docker internal URLs. Here is
an example:

```bash
REDIS_URL="redis://redis:6379"
```

Next, spin up docker containers:

```bash
bun docker
```

You should have a server running on `http://localhost:<port>` where the port is set in your `.env` file (default is 8080).

Open `http://localhost:8080` in your browser to see the demo UI. Each rate limiting algorithm has a card with:

- **Send Request** -- sends a single request through the rate limiter
- **Burst 10** -- sends 10 rapid requests to see the algorithm hit its limit
- **Reset All Counters** -- clears all rate-limit keys from Redis

### API Routes

1. `POST /api/rate-limit/:algorithm` -- Test a single request against the named algorithm
2. `POST /api/rate-limit/:algorithm/burst` -- Send 10 rapid requests against the named algorithm
3. `POST /api/rate-limit/reset` -- Reset all rate-limit counters

Where `:algorithm` is one of: `fixed-window`, `sliding-window-log`, `sliding-window-counter`, `token-bucket`, `leaky-bucket`.

## Running tests

There are some tests in the `__tests__` folder that can be run with the following command:

```bash
bun test
```

These tests setup and teardown on their own. You can modify them if you want to leave data in Redis.

## Running locally outside docker

To run the development server outside of docker:

```bash
bun install
# then
bun dev
```

## Other Scripts

Formatting code:

```bash
bun format
```

Updating dependencies:

```bash
bun update
```

## Connecting to Redis Cloud

If you don't yet have a database setup in Redis Cloud [get started here for free](https://redis.io/try-free/).

Then follow the [Connect to a Redis Cloud database doc](https://redis.io/docs/latest/operate/rc/databases/connect/). You should end up with a connection string that looks like the string below:

```bash
REDIS_URL="redis://default:<password>@redis-#####.c###.us-west-2-#.ec2.redns.redis-cloud.com:#####"
```

Run the [tests](#running-tests) to verify that you are connected properly.

## Learn more

To learn more about Redis, take a look at the following resources:

- [Redis Documentation](https://redis.io/docs/latest/) - learn about Redis products, features, and commands.
- [Redis Tutorials](https://redis.io/tutorials/) - read tutorials, quick starts, and how-to guides for Redis.
- [Redis Demo Center](https://redis.io/demo-center/) - watch short, technical videos about Redis products and features.
