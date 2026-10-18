import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";
import { config } from "../config.js";

// One connection pool shared by the whole service.
const client = postgres(config.db.url, { max: 10 });

export const db = drizzle(client, { schema });

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function closeDb() {
  await client.end();
}