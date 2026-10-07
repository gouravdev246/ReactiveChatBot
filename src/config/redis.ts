import { Redis } from "ioredis";
import dotenv from "dotenv";
dotenv.config();

/**
 * Build an ioredis-compatible TCP connection for BullMQ.
 *
 * Priority:
 *  1. REDIS_URL env var (if user provides a direct TCP redis:// or rediss:// URL)
 *  2. Auto-derive from Upstash REST creds:
 *     REST URL  → https://<host>.upstash.io
 *     ioredis   → rediss://default:<token>@<host>.upstash.io:6379
 */
function buildRedisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !restToken) {
    throw new Error(
      "Missing Redis config. Set REDIS_URL or both UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN in .env"
    );
  }

  // Extract hostname from https://comic-griffon-297209.upstash.io
  const host = new URL(restUrl).hostname;
  return `rediss://default:${restToken}@${host}:6379`;
}

let redisConnection: Redis | null = null;

/**
 * Get a shared ioredis connection (singleton) for BullMQ Queue & Worker.
 */
export function getRedisConnection(): Redis {
  if (!redisConnection) {
    const url = buildRedisUrl();
    redisConnection = new Redis(url, {
      maxRetriesPerRequest: null,  // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        console.log(`[Redis] Retry attempt ${times}, reconnecting in ${delay}ms...`);
        return delay;
      },
    });

    redisConnection.on("connect", () => {
      console.log("[Redis] ✅ Connected successfully");
    });

    redisConnection.on("error", (err: Error) => {
      console.error("[Redis] ❌ Connection error:", err.message);
    });
  }

  return redisConnection;
}

/**
 * Create a NEW ioredis connection (BullMQ needs separate connections for Queue vs Worker).
 */
export function createRedisConnection(): Redis {
  const url = buildRedisUrl();
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number) {
      return Math.min(times * 200, 5000);
    },
  });
}
