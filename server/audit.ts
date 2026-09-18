import crypto from "node:crypto";
import { isFirestoreConfigured, runFirestoreQuery, setFirestoreDocument } from "./firestore.js";
import { getFluxoraCollectionPaths } from "./fluxoraFirestorePaths.js";

export type AuditCategory = "workflow" | "incident" | "configuration" | "access" | "history" | "data";
export type AuditStatus = "success" | "failure";

export type AuditEventInput = {
  action: string;
  category: AuditCategory;
  actor: string;
  actorRole?: string;
  targetType: string;
  targetId?: string | null;
  targetName?: string | null;
  summary: string;
  status?: AuditStatus;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

const COLLECTION = getFluxoraCollectionPaths("auditEvents").destination;
const SECRET_KEY = /(password|senha|secret|token|authorization|cookie|credential|api.?key|private.?key)/i;

function safeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[resumo omitido]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value ?? null;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => safeValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 80).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? "[protegido]" : safeValue(nested, depth + 1),
    ]));
  }
  return String(value);
}

export async function recordAuditEvent(input: AuditEventInput) {
  if (!isFirestoreConfigured()) return null;
  const createdAt = new Date().toISOString();
  const id = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
  const event = {
    id,
    ...input,
    status: input.status ?? "success",
    targetId: input.targetId ?? null,
    targetName: input.targetName ?? null,
    reason: input.reason ?? null,
    before: safeValue(input.before),
    after: safeValue(input.after),
    metadata: safeValue(input.metadata ?? {}),
    createdAt,
  };
  await setFirestoreDocument(COLLECTION, id, event);
  return event;
}

export async function recordAuditEventSafe(input: AuditEventInput) {
  try {
    return await recordAuditEvent(input);
  } catch (error) {
    console.error("AUDIT_WRITE_FAILED", error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function listAuditEvents(input: {
  period?: "today" | "7d" | "30d" | "90d" | "all";
  category?: AuditCategory;
  status?: AuditStatus;
  search?: string;
}) {
  if (!isFirestoreConfigured()) return [];
  const rows = await runFirestoreQuery({
    from: [{ collectionId: COLLECTION }],
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    limit: 500,
  });
  const now = Date.now();
  const since = input.period === "today" ? new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    : input.period === "7d" ? now - 7 * 86_400_000
    : input.period === "30d" ? now - 30 * 86_400_000
    : input.period === "90d" ? now - 90 * 86_400_000
    : 0;
  const search = String(input.search || "").trim().toLowerCase();
  return rows.filter((row) => {
    if (since && new Date(String(row.createdAt || 0)).getTime() < since) return false;
    if (input.category && row.category !== input.category) return false;
    if (input.status && row.status !== input.status) return false;
    if (!search) return true;
    return [row.actor, row.summary, row.targetName, row.targetId, row.action].some((value) => String(value || "").toLowerCase().includes(search));
  }).slice(0, 250);
}
