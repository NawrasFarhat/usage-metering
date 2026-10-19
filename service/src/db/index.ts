import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

// One connection pool shared by the whole service.
const client = postgres(config.db.url, { max: 10 });

export const db = drizzle(client, { schema });

// The type of the "tx" object inside db.transaction(async (tx) => ...).
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Something that can run queries: the shared pool or an open transaction.
export type Executor = typeof db | Tx;

export async function closeDb() {
  await client.end();
}

// Postgres error code for "duplicate key value violates unique constraint".
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}