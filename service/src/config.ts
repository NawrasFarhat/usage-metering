import { existsSync } from "node:fs";

if (existsSync(".env")) {
  process.loadEnvFile();
}

function envOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  adminApiKey: envOrThrow("ADMIN_API_KEY"),
  db: {
    url: envOrThrow("DB_URL"),
    migrationsFolder: "./src/db/migrations",
  },
};