# Fluxora Firestore Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move only the approved `fluxora_*` data into an organized `fluxora/data/...` hierarchy through a compatible, non-destructive migration.

**Architecture:** A registry is the sole authority for allowed legacy and destination collection paths. The data layer adds dual-write and read fallback only through that registry. An administrator-triggered migration copies documents by the same ID in bounded batches and reports counts/ID mismatches without deleting any legacy collection.

**Tech Stack:** TypeScript, Vitest, tRPC, Firestore REST API, React, Vite.

**Spec:** `docs/superpowers/specs/2026-09-18-fluxora-firestore-organization-design.md`

## Global Constraints

- Touch only the 11 collections explicitly named in the specification.
- Never enumerate, modify, move or delete any other Firestore collection or document.
- Keep the panel available through dual-write and new-path-first fallback reads.
- Preserve document IDs and contents during copying.
- Do not add a delete operation for legacy paths.
- Migration is administrator-only and records only safe collection/count/status audit data.

---

## File structure

- Create: `server/fluxoraFirestorePaths.ts` — typed allowlist, destination paths and guarded path lookup.
- Create: `server/fluxoraFirestoreMigration.ts` — batch copier, verifier and safe migration result types.
- Create: `server/fluxoraFirestoreMigration.test.ts` — allowlist, copy, verification and no-delete tests.
- Modify: `server/firestore.ts` — hierarchical document/collection path support without changing unrelated callers.
- Modify: `server/routers.ts` — admin-only status and migration procedures with audit entry.
- Modify: `server/firestoreLogs.ts`, `server/access.ts`, `server/audit.ts`, `server/observability.ts`, `server/googleWorkspace/repository.ts`, `server/notificationState.ts` — replace direct Fluxora collection names with the registry-backed compatibility layer only where each module accesses an allowed collection.
- Modify: `client/src/pages/Settings.tsx` — show migration status/action only to administrators.

### Task 1: Create the strict Fluxora collection registry

**Files:**
- Create: `server/fluxoraFirestorePaths.ts`
- Create: `server/fluxoraFirestoreMigration.test.ts`

**Interfaces:**
- Exports `FluxoraCollectionKey`, `getFluxoraCollectionPaths(key)` and `isAllowedFluxoraLegacyCollection(name)`.
- `getFluxoraCollectionPaths` returns `{ legacy, destination }` and throws for any value outside the literal allowlist.

- [ ] **Step 1: Write the failing allowlist tests**

```ts
expect(getFluxoraCollectionPaths("workspaceSecurityEvents")).toEqual({
  legacy: "fluxora_workspace_security_events",
  destination: "fluxora/data/workspace/security-events",
});
expect(() => isAllowedFluxoraLegacyCollection("customers")).toThrow("not allowed");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

Expected: FAIL because the registry module does not exist.

- [ ] **Step 3: Implement the literal registry**

Define exactly these keys and no generic path constructor: `users`, `auditEvents`, `alertRules`, `incidents`, `notificationState`, `slos`, `system`, `workspaceDirectoryPosture`, `workspaceSecurityEvents`, `workspaceSecurityFindings`, `workspaceSyncState`. Map each one to its legacy collection and approved `fluxora/data/...` destination path.

- [ ] **Step 4: Re-run the test and confirm it passes**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/fluxoraFirestorePaths.ts server/fluxoraFirestoreMigration.test.ts
git commit -m "feat: define Fluxora Firestore collection registry"
```

### Task 2: Add safe hierarchical Firestore path support

**Files:**
- Modify: `server/firestore.ts`
- Test: `server/fluxoraFirestoreMigration.test.ts`

**Interfaces:**
- Exports `listFirestoreCollection(path)` and accepts slash-separated approved paths in get/set/merge/commit helpers.
- Path validation rejects empty segments, `..`, leading/trailing slashes and paths outside callers’ registry use.

- [ ] **Step 1: Write the failing path test**

```ts
expect(normalizeFirestorePath("fluxora/data/workspace/security-events")).toBe("fluxora/data/workspace/security-events");
expect(() => normalizeFirestorePath("fluxora//data")).toThrow("invalid Firestore path");
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 3: Implement minimal path normalization**

Split only on `/`, encode each segment independently in REST URLs and preserve the existing one-segment behavior. Do not change authentication, retry, encoding of field values or any non-Fluxora caller.

- [ ] **Step 4: Re-run the focused test and confirm it passes**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/firestore.ts server/fluxoraFirestoreMigration.test.ts
git commit -m "feat: support organized Fluxora Firestore paths"
```

### Task 3: Implement idempotent copy and verification

**Files:**
- Create: `server/fluxoraFirestoreMigration.ts`
- Modify: `server/fluxoraFirestoreMigration.test.ts`

**Interfaces:**
- Exports `migrateFluxoraCollection(key, adapter)` and `verifyFluxoraCollection(key, adapter)`.
- Adapter contract: `list(path)`, `upsert(path, id, data)` and no delete method.
- Result: `{ key, copied, sourceCount, destinationCount, missingIds, status: "complete" | "mismatch" }`.

- [ ] **Step 1: Write failing migration tests**

```ts
const result = await migrateFluxoraCollection("users", memoryAdapter);
expect(result).toMatchObject({ key: "users", copied: 2, status: "complete" });
expect(memoryAdapter.documents.get("fluxora/data/users/alice")).toEqual({ role: "admin" });
expect(memoryAdapter.operations).not.toContain("delete");
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 3: Implement bounded idempotent copying**

Read exactly one registry-approved legacy path, copy documents with their same IDs to its destination in chunks of 400, then list only the paired destination path to compare counts and IDs. Return mismatch information; never retry by copying data from an unapproved path and never delete.

- [ ] **Step 4: Re-run the test and confirm it passes**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/fluxoraFirestoreMigration.ts server/fluxoraFirestoreMigration.test.ts
git commit -m "feat: migrate approved Fluxora Firestore data"
```

### Task 4: Add compatibility read/write adapters

**Files:**
- Modify: `server/fluxoraFirestoreMigration.ts`
- Modify: the six existing Fluxora data modules listed in File structure.
- Test: `server/fluxoraFirestoreMigration.test.ts` plus each affected module’s existing tests.

- [ ] **Step 1: Write failing compatibility tests**

```ts
await compatibility.write("workspaceSecurityEvents", "event-1", { source: "login" });
expect(adapter.documents.has("fluxora_workspace_security_events/event-1")).toBe(true);
expect(adapter.documents.has("fluxora/data/workspace/security-events/event-1")).toBe(true);
expect(await compatibility.read("workspaceSecurityEvents", "event-1")).toEqual({ source: "login" });
```

- [ ] **Step 2: Run focused tests and confirm they fail**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts server/googleWorkspace/repository.test.ts`

- [ ] **Step 3: Implement the compatibility adapter**

For registry keys only, write destination and legacy paths. Read destination first, then legacy if the destination document/query has no result. Replace hard-coded approved `fluxora_*` names in each listed module with the registry key; leave every other Firestore collection unchanged.

- [ ] **Step 4: Re-run focused tests and confirm they pass**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts server/googleWorkspace/repository.test.ts server/observability.test.ts`

- [ ] **Step 5: Commit**

```bash
git add server/fluxoraFirestoreMigration.ts server/firestoreLogs.ts server/access.ts server/audit.ts server/observability.ts server/googleWorkspace/repository.ts server/notificationState.ts
git commit -m "feat: dual-write approved Fluxora collections"
```

### Task 5: Add the administrator migration operation

**Files:**
- Modify: `server/routers.ts`
- Modify: `client/src/pages/Settings.tsx`
- Test: `server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 1: Write a failing authorization/result test**

```ts
await expect(runFluxoraMigration({ role: "viewer" })).rejects.toThrow("UNAUTHORIZED");
await expect(runFluxoraMigration({ role: "admin" })).resolves.toMatchObject({
  collections: expect.arrayContaining([expect.objectContaining({ key: "users" })]),
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

- [ ] **Step 3: Implement admin-only migration and status procedures**

Add `admin.migrateFluxoraFirestore` and `admin.fluxoraFirestoreMigrationStatus`. The mutation loops only registry keys, returns safe count/status results, and records an audit event with the collection keys and counts only. The Settings page displays the allowed collection list and a confirmation-required “Migrar dados do Fluxora” action; it must not show or permit arbitrary collection names.

- [ ] **Step 4: Re-run focused tests and perform UI build**

Run: `npm test -- --run server/fluxoraFirestoreMigration.test.ts`

Run: `npm run check`

Run: `npm run build:vercel`

- [ ] **Step 5: Commit**

```bash
git add server/routers.ts client/src/pages/Settings.tsx server/fluxoraFirestoreMigration.test.ts
git commit -m "feat: add Fluxora Firestore migration controls"
```

### Task 6: Verify non-destructive migration readiness

**Files:**
- Modify only files required by a failing verification.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run type and production builds**

Run: `npm run check`

Run: `npm run build:vercel`

Expected: both pass.

- [ ] **Step 3: Inspect scope**

Run: `git diff --check`

Expected: no whitespace errors; changed Firestore paths are restricted to the approved Fluxora registry.

- [ ] **Step 4: Commit only required verification fixes**

```bash
git add <only-files-required-by-a-failing-verification>
git commit -m "fix: verify Fluxora Firestore migration"
```

Do not make an empty commit.
