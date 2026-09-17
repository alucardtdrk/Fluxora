import {
  commitFirestoreWrites,
  mergeFirestoreDocument,
  type FirestoreRecord,
} from "../firestore.js";
import type { WorkspaceSecurityEvent, WorkspaceSecuritySource } from "./types.js";

export const WORKSPACE_SECURITY_EVENTS_COLLECTION = "fluxora_workspace_security_events";
export const WORKSPACE_SYNC_STATE_COLLECTION = "fluxora_workspace_sync_state";
export const WORKSPACE_DIRECTORY_POSTURE_COLLECTION = "fluxora_workspace_directory_posture";

export interface WorkspaceFirestoreWrite {
  readonly collection: string;
  readonly id: string;
  readonly data: FirestoreRecord;
}

export interface WorkspaceFirestoreAdapter {
  commit(writes: readonly WorkspaceFirestoreWrite[]): Promise<void>;
  merge(collection: string, id: string, data: FirestoreRecord): Promise<void>;
}

export interface SaveSourceBatchInput {
  readonly source: WorkspaceSecuritySource;
  readonly events: readonly WorkspaceSecurityEvent[];
  readonly nextCursor?: string;
  readonly lastSuccessfulEventAt?: string;
  readonly attemptedAt: string;
}

export interface DirectoryPostureSnapshot extends FirestoreRecord {
  readonly id: string;
  readonly capturedAt: Date;
}

function eventRecord(event: WorkspaceSecurityEvent, ingestedAt: Date): FirestoreRecord {
  return { ...event, ingestedAt };
}

const defaultAdapter: WorkspaceFirestoreAdapter = {
  async commit(writes) {
    await commitFirestoreWrites(writes);
  },
  async merge(collection, id, data) {
    await mergeFirestoreDocument(collection, id, data);
  },
};

export function createGoogleWorkspaceRepository(
  adapter: WorkspaceFirestoreAdapter = defaultAdapter,
  now: () => Date = () => new Date(),
) {
  return {
    async saveSourceBatch(input: SaveSourceBatchInput): Promise<{ insertedOrUpdated: number }> {
      const ingestedAt = now();
      const eventWrites: WorkspaceFirestoreWrite[] = input.events.map((event) => ({
        collection: WORKSPACE_SECURITY_EVENTS_COLLECTION,
        id: event.id,
        data: eventRecord(event, ingestedAt),
      }));
      const successfulState: FirestoreRecord = {
        source: input.source,
        cursor: input.nextCursor ?? null,
        lastAttemptedAt: new Date(input.attemptedAt),
        lastSucceededAt: ingestedAt,
        lastSuccessfulEventAt: input.lastSuccessfulEventAt
          ? new Date(input.lastSuccessfulEventAt)
          : null,
        lastError: null,
      };

      try {
        await adapter.commit([
          ...eventWrites,
          {
            collection: WORKSPACE_SYNC_STATE_COLLECTION,
            id: input.source,
            data: successfulState,
          },
        ]);
      } catch (error) {
        await adapter.merge(WORKSPACE_SYNC_STATE_COLLECTION, input.source, {
          source: input.source,
          lastAttemptedAt: new Date(input.attemptedAt),
          lastError: "persistence",
        });
        throw error;
      }

      return { insertedOrUpdated: input.events.length };
    },

    async saveDirectoryPosture(snapshot: DirectoryPostureSnapshot): Promise<void> {
      const { id, ...data } = snapshot;
      await adapter.commit([{
        collection: WORKSPACE_DIRECTORY_POSTURE_COLLECTION,
        id,
        data,
      }]);
    },
  };
}

export const googleWorkspaceRepository = createGoogleWorkspaceRepository();
