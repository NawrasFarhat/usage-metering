import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

export function generateApiKey(): string {
  return "mk_" + randomBytes(32).toString("hex");
}


export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
