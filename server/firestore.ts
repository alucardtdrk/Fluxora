import crypto from "node:crypto";

export type FirestoreRecord = Record<string, unknown>;

type FirebaseConfig = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

async function fetchWithRetry(url: string, init?: RequestInit, attempts = 3) {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.status !== 429 && response.status < 500) return response;
      lastError = new Error(`HTTP_${response.status}`);
      if (attempt === attempts - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (2 ** attempt)));
  }
  throw lastError instanceof Error ? lastError : new Error("FETCH_FAILED");
}

function cleanEnv(value?: string) {
  const trimmed = String(value || "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function getFirebaseConfig(): FirebaseConfig | null {
  const projectId = cleanEnv(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = cleanEnv(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = cleanEnv(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

export function isFirestoreConfigured() {
  return Boolean(getFirebaseConfig());
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken() {
  const config = getFirebaseConfig();
  if (!config) throw new Error("FIREBASE_NOT_CONFIGURED");

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: config.clientEmail,
    sub: config.clientEmail,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/datastore",
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), config.privateKey).toString("base64url");
  const assertion = `${unsigned}.${signature}`;

  const response = await fetchWithRetry("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`FIREBASE_AUTH_${response.status}:${await response.text()}`);
  }

  const json = await response.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("FIREBASE_AUTH_NO_TOKEN");

  tokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(300, Number(json.expires_in || 3600) - 120) * 1000,
  };
  return tokenCache.accessToken;
}

function databaseBase(projectId: string) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
}

export function normalizeFirestorePath(path: string) {
  const segments = path.split("/");
  if (!path || path.startsWith("/") || path.endsWith("/") || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("invalid Firestore path");
  }
  return segments.join("/");
}

function encodeFirestorePath(path: string) {
  return normalizeFirestorePath(path).split("/").map(encodeURIComponent).join("/");
}

export function getFirestoreCollectionQueryPath(collection: string) {
  const segments = normalizeFirestorePath(collection).split("/");
  if (segments.length % 2 === 0) throw new Error("invalid Firestore collection path");
  const collectionId = segments.at(-1)!;
  const parent = segments.slice(0, -1).join("/");
  return {
    endpoint: parent ? `/${encodeFirestorePath(parent)}:runQuery` : ":runQuery",
    collectionId,
  };
}

async function firestoreFetch(path: string, init?: RequestInit) {
  const config = getFirebaseConfig();
  if (!config) throw new Error("FIREBASE_NOT_CONFIGURED");
  const accessToken = await getAccessToken();
  const response = await fetchWithRetry(`${databaseBase(config.projectId)}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });
  return response;
}

function encodeValue(value: unknown): any {
  if (value === undefined || value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    // Persist arrays as a tagged map instead of Firestore arrayValue.
    // n8n execution payloads frequently contain deeply nested arrays and
    // Firestore rejects some of those shapes with
    // "Property array contains an invalid nested entity".
    // The JSON marker keeps the complete structure and decodeValue restores
    // it as a normal JavaScript array when the Fluxora reads the document.
    let json = "[]";
    try {
      json = JSON.stringify(value, (_key, nested) =>
        typeof nested === "bigint" ? nested.toString() : nested,
      );
    } catch {
      json = JSON.stringify(value.map((item) => String(item ?? "")));
    }

    return {
      mapValue: {
        fields: {
          __fluxoraArray: { booleanValue: true },
          json: { stringValue: json },
          length: { integerValue: String(value.length) },
        },
      },
    };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "object") {
    return { mapValue: { fields: encodeFields(value as FirestoreRecord) } };
  }
  return { stringValue: String(value) };
}

function encodeFields(record: FirestoreRecord) {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    fields[key] = encodeValue(value);
  }
  return fields;
}

function decodeValue(value: any): unknown {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("arrayValue" in value) return (value.arrayValue?.values || []).map(decodeValue);
  if ("mapValue" in value) {
    const fields = value.mapValue?.fields || {};
    if (fields.__fluxoraArray?.booleanValue === true && typeof fields.json?.stringValue === "string") {
      try {
        const parsed = JSON.parse(fields.json.stringValue);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return decodeFields(fields);
  }
  return null;
}

function decodeFields(fields: Record<string, any>) {
  const record: FirestoreRecord = {};
  for (const [key, value] of Object.entries(fields || {})) record[key] = decodeValue(value);
  return record;
}

function documentIdFromName(name?: string) {
  if (!name) return "";
  return decodeURIComponent(name.split("/").pop() || "");
}

function decodeDocument(document: any): FirestoreRecord & { _documentId: string } {
  return {
    _documentId: documentIdFromName(document?.name),
    ...decodeFields(document?.fields || {}),
  };
}

function resourceName(projectId: string, collection: string, id: string) {
  return `projects/${projectId}/databases/(default)/documents/${encodeFirestorePath(collection)}/${encodeURIComponent(id)}`;
}

export async function getFirestoreDocument(collection: string, id: string) {
  const response = await firestoreFetch(`/${encodeFirestorePath(collection)}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FIRESTORE_GET_${response.status}:${await response.text()}`);
  return decodeDocument(await response.json());
}

export async function listFirestoreCollection(collection: string) {
  const response = await firestoreFetch(`/${encodeFirestorePath(collection)}`);
  if (!response.ok) throw new Error(`FIRESTORE_LIST_${response.status}:${await response.text()}`);
  const json = await response.json() as { documents?: unknown[] };
  return (json.documents ?? []).map(decodeDocument);
}

export async function setFirestoreDocument(collection: string, id: string, data: FirestoreRecord) {
  const response = await firestoreFetch(`/${encodeFirestorePath(collection)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_SET_${response.status}:${await response.text()}`);
  return decodeDocument(await response.json());
}

export async function mergeFirestoreDocument(collection: string, id: string, data: FirestoreRecord) {
  const fields = encodeFields(data);
  const updateMask = Object.keys(fields)
    .map((fieldPath) => `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`)
    .join("&");
  const suffix = updateMask ? `?${updateMask}` : "";
  const response = await firestoreFetch(`/${encodeFirestorePath(collection)}/${encodeURIComponent(id)}${suffix}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_MERGE_${response.status}:${await response.text()}`);
  return decodeDocument(await response.json());
}

export interface FirestoreWrite {
  collection: string;
  id: string;
  data: FirestoreRecord;
  merge?: boolean;
}

export async function commitFirestoreWrites(documents: readonly FirestoreWrite[]) {
  if (!documents.length) return { writes: 0 };
  if (documents.length > 500) throw new Error("FIRESTORE_COMMIT_TOO_MANY_WRITES");
  const config = getFirebaseConfig();
  if (!config) throw new Error("FIREBASE_NOT_CONFIGURED");

  const response = await firestoreFetch(":commit", {
    method: "POST",
    body: JSON.stringify({
      writes: documents.map(({ collection, id, data, merge }) => ({
        update: {
          name: resourceName(config.projectId, collection, id),
          fields: encodeFields(data),
        },
        ...(merge ? { updateMask: { fieldPaths: Object.keys(data) } } : {}),
      })),
    }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_COMMIT_${response.status}:${await response.text()}`);
  return { writes: documents.length };
}

export async function commitFirestoreDocuments(collection: string, documents: Array<{ id: string; data: FirestoreRecord }>) {
  if (!documents.length) return { writes: 0 };
  const config = getFirebaseConfig();
  if (!config) throw new Error("FIREBASE_NOT_CONFIGURED");

  let writes = 0;
  for (let offset = 0; offset < documents.length; offset += 400) {
    const chunk = documents.slice(offset, offset + 400);
    const response = await firestoreFetch(":commit", {
      method: "POST",
      body: JSON.stringify({
        writes: chunk.map(({ id, data }) => {
          const fields = encodeFields(data);
          return {
            update: {
              name: resourceName(config.projectId, collection, id),
              fields,
            },
            // Summary synchronizations must not erase node details that were
            // previously archived from a full n8n execution response.
            updateMask: { fieldPaths: Object.keys(fields) },
          };
        }),
      }),
    });
    if (!response.ok) throw new Error(`FIRESTORE_COMMIT_${response.status}:${await response.text()}`);
    writes += chunk.length;
  }
  return { writes };
}


export async function deleteFirestoreDocument(collection: string, id: string) {
  const response = await firestoreFetch(`/${encodeFirestorePath(collection)}/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (response.status === 404) return { deleted: false };
  if (!response.ok) throw new Error(`FIRESTORE_DELETE_${response.status}:${await response.text()}`);
  return { deleted: true };
}

export async function countFirestoreCollection(collection: string) {
  const response = await firestoreFetch(":runAggregationQuery", {
    method: "POST",
    body: JSON.stringify({
      structuredAggregationQuery: {
        structuredQuery: { from: [{ collectionId: collection }] },
        aggregations: [{ alias: "total", count: {} }],
      },
    }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_COUNT_${response.status}:${await response.text()}`);
  const rows = await response.json() as any[];
  const raw = rows?.[0]?.result?.aggregateFields?.total?.integerValue ?? rows?.[0]?.result?.aggregateFields?.total?.doubleValue ?? 0;
  return Number(raw || 0);
}
export async function runFirestoreQuery(structuredQuery: FirestoreRecord) {
  const from = Array.isArray(structuredQuery.from) ? structuredQuery.from : [];
  const firstFrom = from[0] as FirestoreRecord | undefined;
  const collection = typeof firstFrom?.collectionId === "string" ? firstFrom.collectionId : "";
  const queryPath = getFirestoreCollectionQueryPath(collection);
  const normalizedQuery = {
    ...structuredQuery,
    from: [{ ...firstFrom, collectionId: queryPath.collectionId }, ...from.slice(1)],
  };
  const response = await firestoreFetch(queryPath.endpoint, {
    method: "POST",
    body: JSON.stringify({ structuredQuery: normalizedQuery }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_QUERY_${response.status}:${await response.text()}`);
  const rows = await response.json() as any[];
  return rows.flatMap((row) => row?.document ? [decodeDocument(row.document)] : []);
}
