import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import WebSocket from "ws";
import { Resolver } from "node:dns/promises";
import { execSync } from "child_process";

const dnsResolver = new Resolver();
dnsResolver.setServers(["8.8.8.8", "1.1.1.1"]);

const customLookup = (hostname: string, options: any, callback: any) => {
  const cb = typeof options === "function" ? options : callback;
  const opt = typeof options === "object" ? options : {};
  dnsResolver.resolve4(hostname)
    .then((ips) => {
      if (opt?.all) {
        cb(null, ips.map((a) => ({ address: a, family: 4 })));
      } else {
        cb(null, ips[0], 4);
      }
    })
    .catch((err) => cb(err));
};

class ResilientWebSocket extends WebSocket {
  constructor(address: any, protocols?: any, options?: any) {
    const opts = (typeof protocols === "object" && !Array.isArray(protocols) ? protocols : options) || {};
    opts.lookup = customLookup;
    super(address, Array.isArray(protocols) ? protocols : undefined, opts);
  }
}

neonConfig.webSocketConstructor = ResilientWebSocket as any;

async function migrate() {
  const connectionString = process.env.DATABASE_URL || process.env.DB_URI;
  if (!connectionString) {
    throw new Error("DATABASE_URL or DB_URI is missing in .env");
  }

  console.log("Connecting to Neon via secure WebSocket pool...");
  const pool = new Pool({ connectionString });

  console.log("Executing idempotent schema migration on Neon...");
  const ddl = `
    ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastInteractionAt" TIMESTAMP(3);

    DO $$ BEGIN
        CREATE TYPE "ScheduledMessageStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'SKIPPED', 'FAILED');
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;

    CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "bullJobId" TEXT,
        "scheduledAt" TIMESTAMP(3) NOT NULL,
        "lastUserMessage" TEXT NOT NULL,
        "status" "ScheduledMessageStatus" NOT NULL DEFAULT 'PENDING',
        "reason" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL,
        CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
    );

    CREATE TABLE IF NOT EXISTS "ProactiveMessageLog" (
        "id" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "messageSent" TEXT NOT NULL,
        "context" TEXT,
        "aiDecision" JSONB,
        "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ProactiveMessageLog_pkey" PRIMARY KEY ("id")
    );

    CREATE UNIQUE INDEX IF NOT EXISTS "ScheduledMessage_bullJobId_key" ON "ScheduledMessage"("bullJobId");
    CREATE INDEX IF NOT EXISTS "ScheduledMessage_userId_status_idx" ON "ScheduledMessage"("userId", "status");
    CREATE INDEX IF NOT EXISTS "ScheduledMessage_scheduledAt_idx" ON "ScheduledMessage"("scheduledAt");
    CREATE INDEX IF NOT EXISTS "ProactiveMessageLog_userId_idx" ON "ProactiveMessageLog"("userId");
    CREATE INDEX IF NOT EXISTS "ProactiveMessageLog_sentAt_idx" ON "ProactiveMessageLog"("sentAt");

    DO $$ BEGIN
        ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;

    DO $$ BEGIN
        ALTER TABLE "ProactiveMessageLog" ADD CONSTRAINT "ProactiveMessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    EXCEPTION
        WHEN duplicate_object THEN null;
    END $$;
  `;

  await pool.query(ddl);

  const res = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
  );
  console.log("Migration completed successfully! 🚀");
  console.log("Current tables in database:", res.rows.map((r: any) => r.table_name));

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
