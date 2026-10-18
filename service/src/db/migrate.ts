import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { config } from "../config.js";

export async function runMigrations() {
  const client = postgres(config.db.url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: config.db.migrationsFolder });
  } finally {
    await client.end();
  }
}