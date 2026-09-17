import crypto from "node:crypto";

export function isInternalRequestAuthorized(headers: Record<string, unknown>, environment: Record<string, string | undefined> = process.env): boolean {
  const expected = String(environment.CRON_SECRET || environment.FLUXORA_SYNC_SECRET || "").trim();
  const authorization = String(headers.authorization || "");
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
