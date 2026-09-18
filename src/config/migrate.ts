import "dotenv/config";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { execSync } from "child_process";

neonConfig.webSocketConstructor = ws;

async function migrate() {
  const connectionString = process.env.DATABASE_URL || process.env.DB_URI;
  if (!connectionString) {
    throw new Error("DATABASE_URL or DB_URI is missing in .env");
  }

  console.log("Generating SQL migration from schema...");
  const sql = execSync("npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script").toString();

  console.log("Connecting to Neon via secure WebSocket pool...");
  const pool = new Pool({ connectionString });

  console.log("Executing SQL migration on Neon...");
  await pool.query(sql);

  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
  console.log("Migration completed successfully!");
  console.log("Tables in Neon database:", res.rows.map((r) => r.table_name));

  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
