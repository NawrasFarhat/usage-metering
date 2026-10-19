import { BadRequestError } from "./errors.js";


export function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequestError("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string, maxLength = 200): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new BadRequestError(`${field} is required and must be a non-empty string`);
  }
  if (value.length > maxLength) {
    throw new BadRequestError(`${field} must be at most ${maxLength} characters`);
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string, maxLength = 200): string | undefined {
  if (body[field] === undefined) {
    return undefined;
  }
  return requireString(body, field, maxLength);
}

// Whole numbers only: rejects 2.5, "10", true, NaN, Infinity.
export function requireInt(body: Record<string, unknown>, field: string, min: number): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new BadRequestError(`${field} must be a whole number >= ${min}`);
  }
  return value;
}

export function optionalInt(body: Record<string, unknown>, field: string, min: number): number | undefined {
  if (body[field] === undefined) {
    return undefined;
  }
  return requireInt(body, field, min);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres throws (-> 500) if a uuid column is compared with a non-uuid string,
// so ids are validated before they reach the database.
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function requireUuid(body: Record<string, unknown>, field: string): string {
  const value = requireString(body, field, 36);
  if (!isUuid(value)) {
    throw new BadRequestError(`${field} must be a valid UUID`);
  }
  return value;
}

export function optionalUuid(body: Record<string, unknown>, field: string): string | undefined {
  if (body[field] === undefined) {
    return undefined;
  }
  return requireUuid(body, field);
}

// ?limit=20&offset=0
export function parsePagination(query: Record<string, unknown>): { limit: number; offset: number } {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  const offset = query.offset === undefined ? 0 : Number(query.offset);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new BadRequestError("limit must be a whole number between 1 and 100");
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new BadRequestError("offset must be a whole number >= 0");
  }
  return { limit, offset };
}