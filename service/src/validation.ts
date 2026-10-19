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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function optionalUuid(body: Record<string, unknown>, field: string): string | undefined {
  const value = optionalString(body, field, 36);
  if (value !== undefined && !isUuid(value)) {
    throw new BadRequestError(`${field} must be a valid UUID`);
  }
  return value;
}