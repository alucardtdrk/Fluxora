import {
  deleteFirestoreDocument,
  getFirestoreDocument,
  isFirestoreConfigured,
  runFirestoreQuery,
  setFirestoreDocument,
  type FirestoreRecord,
} from "./firestore.js";
import { getFluxoraCollectionPaths } from "./fluxoraFirestorePaths.js";

export type FluxoraRole = "admin" | "operator" | "viewer";

export type FluxoraUser = {
  email: string;
  name: string;
  role: FluxoraRole;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
  lastLoginAt?: string | null;
  createdBy?: string | null;
};

const USERS_COLLECTION = getFluxoraCollectionPaths("users").destination;
const CACHE_TTL_MS = 15_000;
const accessCache = new Map<string, { user: FluxoraUser | null; expiresAt: number }>();

function normalizeEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}

function bootstrapAdmins() {
  return new Set(
    String(process.env.FLUXORA_ADMIN_EMAILS || "")
      .split(/[;,\s]+/)
      .map(normalizeEmail)
      .filter(Boolean),
  );
}

export function accessControlConfigured() {
  return isFirestoreConfigured() && bootstrapAdmins().size > 0;
}

export function isBootstrapAdmin(email: string) {
  return bootstrapAdmins().has(normalizeEmail(email));
}

function toUser(row: any): FluxoraUser | null {
  const email = normalizeEmail(String(row?.email || row?._documentId || ""));
  if (!email) return null;
  const role = ["admin", "operator", "viewer"].includes(String(row?.role)) ? String(row.role) as FluxoraRole : "viewer";
  return {
    email,
    name: String(row?.name || email.split("@")[0] || "Usuário"),
    role,
    active: row?.active !== false,
    createdAt: row?.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row?.updatedAt ? String(row.updatedAt) : undefined,
    lastLoginAt: row?.lastLoginAt == null ? null : String(row.lastLoginAt),
    createdBy: row?.createdBy == null ? null : String(row.createdBy),
  };
}

export async function getFluxoraUser(email: string, options?: { bypassCache?: boolean }) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  if (!options?.bypassCache) {
    const cached = accessCache.get(normalized);
    if (cached && cached.expiresAt > Date.now()) return cached.user;
  }

  if (isBootstrapAdmin(normalized)) {
    const stored = isFirestoreConfigured() ? await getFirestoreDocument(USERS_COLLECTION, normalized).catch(() => null) : null;
    const user: FluxoraUser = {
      email: normalized,
      name: String(stored?.name || normalized.split("@")[0] || "Administrador"),
      role: "admin",
      active: true,
      createdAt: stored?.createdAt ? String(stored.createdAt) : undefined,
      updatedAt: stored?.updatedAt ? String(stored.updatedAt) : undefined,
      lastLoginAt: stored?.lastLoginAt == null ? null : String(stored.lastLoginAt),
      createdBy: stored?.createdBy == null ? "bootstrap" : String(stored.createdBy),
    };
    accessCache.set(normalized, { user, expiresAt: Date.now() + CACHE_TTL_MS });
    return user;
  }

  if (!isFirestoreConfigured()) return null;
  const row = await getFirestoreDocument(USERS_COLLECTION, normalized);
  const user = row ? toUser(row) : null;
  accessCache.set(normalized, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

export async function authorizeGoogleUser(profile: { email: string; name: string }) {
  const email = normalizeEmail(profile.email);
  if (!email) return null;

  const existing = await getFluxoraUser(email, { bypassCache: true });
  if (!existing || !existing.active) return null;

  const now = new Date().toISOString();
  const user: FluxoraUser = { ...existing, name: profile.name || existing.name, lastLoginAt: now, updatedAt: now };
  if (isFirestoreConfigured()) {
    await setFirestoreDocument(USERS_COLLECTION, email, user as unknown as FirestoreRecord);
  }
  accessCache.set(email, { user, expiresAt: Date.now() + CACHE_TTL_MS });
  return user;
}

export async function listFluxoraUsers() {
  if (!isFirestoreConfigured()) return [] as FluxoraUser[];
  const rows = await runFirestoreQuery({
    from: [{ collectionId: USERS_COLLECTION }],
    limit: 500,
  });
  const users = rows.map(toUser).filter(Boolean) as FluxoraUser[];
  for (const email of bootstrapAdmins()) {
    if (!users.some((user) => user.email === email)) {
      users.push({ email, name: email.split("@")[0] || "Administrador", role: "admin", active: true, createdBy: "bootstrap" });
    }
  }
  return users.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export async function upsertFluxoraUser(input: { email: string; name?: string; role: FluxoraRole; active?: boolean; actor: string }) {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("INVALID_EMAIL");
  const domain = String(process.env.GOOGLE_ALLOWED_DOMAIN || "").trim().toLowerCase();
  if (domain && !email.endsWith(`@${domain}`)) throw new Error("DOMAIN_NOT_ALLOWED");

  const current = await getFirestoreDocument(USERS_COLLECTION, email).catch(() => null);
  const now = new Date().toISOString();
  const role: FluxoraRole = isBootstrapAdmin(email) ? "admin" : input.role;
  const user: FluxoraUser = {
    email,
    name: String(input.name || current?.name || email.split("@")[0] || "Usuário"),
    role,
    active: isBootstrapAdmin(email) ? true : input.active !== false,
    createdAt: current?.createdAt ? String(current.createdAt) : now,
    updatedAt: now,
    lastLoginAt: current?.lastLoginAt == null ? null : String(current.lastLoginAt),
    createdBy: current?.createdBy == null ? input.actor : String(current.createdBy),
  };
  await setFirestoreDocument(USERS_COLLECTION, email, user as unknown as FirestoreRecord);
  accessCache.delete(email);
  return user;
}

export async function setFluxoraUserActive(emailInput: string, active: boolean, actor: string) {
  const email = normalizeEmail(emailInput);
  if (isBootstrapAdmin(email) && !active) throw new Error("BOOTSTRAP_ADMIN_PROTECTED");
  const current = await getFluxoraUser(email, { bypassCache: true });
  if (!current) throw new Error("USER_NOT_FOUND");
  return upsertFluxoraUser({ ...current, email, active, actor });
}

export async function deleteFluxoraUser(emailInput: string) {
  const email = normalizeEmail(emailInput);
  if (isBootstrapAdmin(email)) throw new Error("BOOTSTRAP_ADMIN_PROTECTED");
  await deleteFirestoreDocument(USERS_COLLECTION, email);
  accessCache.delete(email);
  return { success: true } as const;
}
