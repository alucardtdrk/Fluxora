import { fluxoraCollectionKeys, getFluxoraCollectionPaths, type FluxoraCollectionKey } from "./fluxoraFirestorePaths.js";
import { listFirestoreCollection, setFirestoreDocument } from "./firestore.js";

export interface FluxoraMigrationAdapter {
  list(path: string): Promise<readonly { readonly id: string; readonly data: Record<string, unknown> }[]>;
  upsert(path: string, id: string, data: Record<string, unknown>): Promise<void>;
}

export interface FluxoraMigrationResult {
  readonly key: FluxoraCollectionKey;
  readonly copied: number;
  readonly sourceCount: number;
  readonly destinationCount: number;
  readonly missingIds: readonly string[];
  readonly status: "complete" | "mismatch";
}

export async function migrateFluxoraCollection(key: FluxoraCollectionKey, adapter: FluxoraMigrationAdapter): Promise<FluxoraMigrationResult> {
  const paths = getFluxoraCollectionPaths(key);
  const source = await adapter.list(paths.legacy);
  for (let offset = 0; offset < source.length; offset += 400) {
    await Promise.all(source.slice(offset, offset + 400).map((document) => adapter.upsert(paths.destination, document.id, document.data)));
  }
  const destination = await adapter.list(paths.destination);
  const destinationIds = new Set(destination.map((document) => document.id));
  const missingIds = source.map((document) => document.id).filter((id) => !destinationIds.has(id));
  return { key, copied: source.length, sourceCount: source.length, destinationCount: destination.length, missingIds, status: missingIds.length === 0 && source.length === destination.length ? "complete" : "mismatch" };
}

const firestoreMigrationAdapter: FluxoraMigrationAdapter = {
  async list(path) {
    const records = await listFirestoreCollection(path);
    return records.map(({ _documentId, ...data }) => ({ id: _documentId, data }));
  },
  async upsert(path, id, data) {
    await setFirestoreDocument(path, id, data);
  },
};

export async function migrateAllFluxoraCollections() {
  const collections: FluxoraMigrationResult[] = [];
  for (const key of fluxoraCollectionKeys) collections.push(await migrateFluxoraCollection(key, firestoreMigrationAdapter));
  return { collections };
}
