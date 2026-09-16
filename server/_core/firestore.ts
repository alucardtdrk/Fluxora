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

  const response = await fetch("https://oauth2.googleapis.com/token", {
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

async function firestoreFetch(path: string, init?: RequestInit) {
  const config = getFirebaseConfig();
  if (!config) throw new Error("FIREBASE_NOT_CONFIGURED");
  const accessToken = await getAccessToken();
  const response = await fetch(`${databaseBase(config.projectId)}${path}`, {
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
    // Firestore does not allow an array value to contain another array value
    // directly. n8n execution payloads commonly contain nested arrays
    // (for example run.data.main = [[...], [...]]). Wrap nested arrays in a
    // map so the structure remains serializable without losing the values.
    return {
      arrayValue: {
        values: value.map((item) =>
          Array.isArray(item)
            ? { mapValue: { fields: { items: encodeValue(item) } } }
            : encodeValue(item),
        ),
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
  if ("mapValue" in value) return decodeFields(value.mapValue?.fields || {});
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
  return `projects/${projectId}/databases/(default)/documents/${collection}/${id}`;
}

export async function getFirestoreDocument(collection: string, id: string) {
  const response = await firestoreFetch(`/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`FIRESTORE_GET_${response.status}:${await response.text()}`);
  return decodeDocument(await response.json());
}

export async function setFirestoreDocument(collection: string, id: string, data: FirestoreRecord) {
  const response = await firestoreFetch(`/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ fields: encodeFields(data) }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_SET_${response.status}:${await response.text()}`);
  return decodeDocument(await response.json());
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
        writes: chunk.map(({ id, data }) => ({
          update: {
            name: resourceName(config.projectId, collection, id),
            fields: encodeFields(data),
          },
        })),
      }),
    });
    if (!response.ok) throw new Error(`FIRESTORE_COMMIT_${response.status}:${await response.text()}`);
    writes += chunk.length;
  }
  return { writes };
}


export async function deleteFirestoreDocument(collection: string, id: string) {
  const response = await firestoreFetch(`/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`, { method: "DELETE" });
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
  const response = await firestoreFetch(":runQuery", {
    method: "POST",
    body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) throw new Error(`FIRESTORE_QUERY_${response.status}:${await response.text()}`);
  const rows = await response.json() as any[];
  return rows.flatMap((row) => row?.document ? [decodeDocument(row.document)] : []);
}
