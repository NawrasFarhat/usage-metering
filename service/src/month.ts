import { sql } from "drizzle-orm";
import type { Executor } from "./db/index.js";
import { BadRequestError } from "./errors.js";


export async function currentMonth(exec: Executor): Promise<string> {
  const rows = await exec.execute<{ month: string }>(
    sql`select to_char(date_trunc('month', now() at time zone 'utc'), 'YYYY-MM-DD') as month`,
  );
  return rows[0].month;
}

export function parseMonthParam(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new BadRequestError("month must look like YYYY-MM");
  }
  return `${value}-01`;
}

export function formatMonth(month: string): string {
  return month.slice(0, 7);
}