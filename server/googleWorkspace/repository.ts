import {
  commitFirestoreWrites,
  getFirestoreDocument,
  mergeFirestoreDocument,
  runFirestoreQuery,
  type FirestoreRecord,
} from "../firestore.js";
import { getFluxoraCollectionPaths } from "../fluxoraFirestorePaths.js";
import type { WorkspaceSecurityEvent, WorkspaceSecurityFinding, WorkspaceSecuritySource } from "./types.js";

export const WORKSPACE_SECURITY_EVENTS_COLLECTION = getFluxoraCollectionPaths("workspaceSecurityEvents").destination;
export const WORKSPACE_SECURITY_FINDINGS_COLLECTION = getFluxoraCollectionPaths("workspaceSecurityFindings").destination;
export const WORKSPACE_SYNC_STATE_COLLECTION = getFluxoraCollectionPaths("workspaceSyncState").destination;
export const WORKSPACE_DIRECTORY_POSTURE_COLLECTION = getFluxoraCollectionPaths("workspaceDirectoryPosture").destination;

export interface WorkspaceFirestoreWrite {
  readonly collection: string;
  readonly id: string;
  readonly data: FirestoreRecord;
}

export interface WorkspaceFirestoreAdapter {
  commit(writes: readonly WorkspaceFirestoreWrite[]): Promise<void>;
  merge(collection: string, id: string, data: FirestoreRecord): Promise<void>;
  get?(collection: string, id: string): Promise<FirestoreRecord | null>;
}

export interface SaveSourceBatchInput {
  readonly source: WorkspaceSecuritySource;
  readonly events: readonly WorkspaceSecurityEvent[];
  readonly nextCursor?: string;
  readonly lastSuccessfulEventAt?: string;
  readonly attemptedAt: string;
  readonly backfill?: { readonly targetStart: string; readonly targetEnd: string; readonly coveredThrough: string; readonly pageToken?: string };
  readonly current?: { readonly start: string; readonly end: string; readonly pageToken?: string };
}

export interface WorkspaceSourceState {
  readonly lastSuccessfulEventAt: Date | null;
  readonly currentStart?: Date | null;
  readonly currentEnd?: Date | null;
  readonly currentPageToken?: string | null;
  readonly backfillTargetStart: Date | null;
  readonly backfillTargetEnd: Date | null;
  readonly backfillCoveredThrough: Date | null;
  readonly backfillPageToken: string | null;
}

export interface DirectoryPostureSnapshot extends FirestoreRecord {
  readonly id: string;
  readonly capturedAt: Date;
}

function eventRecord(event: WorkspaceSecurityEvent, ingestedAt: Date): FirestoreRecord {
  return { ...event, ingestedAt };
}

function asRecentEvent(record: FirestoreRecord): WorkspaceSecurityEvent | null {
  const toDate = (value: unknown) => value instanceof Date ? value : new Date(String(value || ""));
  const occurredAt = toDate(record.occurredAt);
  const observedAt = toDate(record.observedAt);
  const expiresAt = toDate(record.expiresAt);
  if (!Number.isFinite(occurredAt.getTime()) || !Number.isFinite(observedAt.getTime()) || !Number.isFinite(expiresAt.getTime())) return null;
  return { ...record, occurredAt, observedAt, expiresAt } as WorkspaceSecurityEvent;
}

const defaultAdapter: WorkspaceFirestoreAdapter = {
  async commit(writes) {
    await commitFirestoreWrites(writes);
  },
  async merge(collection, id, data) {
    await mergeFirestoreDocument(collection, id, data);
  },
  async get(collection, id) {
    return getFirestoreDocument(collection, id);
  },
};

export function createGoogleWorkspaceRepository(
  adapter: WorkspaceFirestoreAdapter = defaultAdapter,
  now: () => Date = () => new Date(),
) {
  return {
    async getSourceState(source: WorkspaceSecuritySource): Promise<WorkspaceSourceState> {
      const record = await adapter.get?.(WORKSPACE_SYNC_STATE_COLLECTION, source);
      const date = (value: unknown) => {
        const parsed = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
        return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
      };
      return { lastSuccessfulEventAt: date(record?.lastSuccessfulEventAt), currentStart: date(record?.currentStart), currentEnd: date(record?.currentEnd), currentPageToken: typeof record?.currentPageToken === "string" ? record.currentPageToken : null, backfillTargetStart: date(record?.backfillTargetStart), backfillTargetEnd: date(record?.backfillTargetEnd), backfillCoveredThrough: date(record?.backfillCoveredThrough), backfillPageToken: typeof record?.backfillPageToken === "string" ? record.backfillPageToken : null };
    },

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
        ...(input.backfill ? { backfillTargetStart: new Date(input.backfill.targetStart), backfillTargetEnd: new Date(input.backfill.targetEnd), backfillCoveredThrough: new Date(input.backfill.coveredThrough), backfillPageToken: input.backfill.pageToken ?? null } : {}),
        ...(input.current ? { currentStart: input.current.pageToken ? new Date(input.current.start) : null, currentEnd: input.current.pageToken ? new Date(input.current.end) : null, currentPageToken: input.current.pageToken ?? null } : {}),
      };

      try {
        const batches = eventWrites.length
          ? Array.from({ length: Math.ceil(eventWrites.length / 499) }, (_value, index) => eventWrites.slice(index * 499, (index + 1) * 499))
          : [[]];
        for (let index = 0; index < batches.length; index += 1) {
          const isFinalBatch = index === batches.length - 1;
          await adapter.commit([
            ...batches[index]!,
            ...(isFinalBatch ? [{
              collection: WORKSPACE_SYNC_STATE_COLLECTION,
              id: input.source,
              data: successfulState,
            }] : []),
          ]);
        }
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

    async saveSourceDiagnostics(source: WorkspaceSecuritySource, diagnostic: { status: string; received?: number; collected: number; persisted: number; safeError?: string; httpStatus?: number; completedAt: string }): Promise<void> {
      await adapter.merge(WORKSPACE_SYNC_STATE_COLLECTION, source, {
        source,
        lastStatus: diagnostic.status,
        lastReceived: diagnostic.received ?? diagnostic.collected,
        lastCollected: diagnostic.collected,
        lastPersisted: diagnostic.persisted,
        lastSafeError: diagnostic.safeError ?? null,
        lastHttpStatus: diagnostic.httpStatus ?? null,
        lastCompletedAt: new Date(diagnostic.completedAt),
      });
    },

    async saveFindings(findings: readonly WorkspaceSecurityFinding[]): Promise<{ insertedOrUpdated: number }> {
      for (let offset = 0; offset < findings.length; offset += 499) {
        await adapter.commit(findings.slice(offset, offset + 499).map((finding) => ({
          collection: WORKSPACE_SECURITY_FINDINGS_COLLECTION,
          id: finding.id,
          data: { ...finding },
        })));
      }
      return { insertedOrUpdated: findings.length };
    },

    async listRecentEvents(since: Date): Promise<readonly WorkspaceSecurityEvent[]> {
      const records = await runFirestoreQuery({
        from: [{ collectionId: WORKSPACE_SECURITY_EVENTS_COLLECTION }],
        where: { fieldFilter: { field: { fieldPath: "occurredAt" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since.toISOString() } } },
        orderBy: [{ field: { fieldPath: "occurredAt" }, direction: "ASCENDING" }],
        limit: 1000,
      });
      return records.map(asRecentEvent).filter((event): event is WorkspaceSecurityEvent => Boolean(event));
    },
  };
}

export const googleWorkspaceRepository = createGoogleWorkspaceRepository();
