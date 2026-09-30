# Google Workspace Audit Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show source-level audit health in Workspace Security and collect additional security-relevant Google Reports activity.

**Architecture:** Extend the existing Workspace synchronization checkpoint with safe per-source run diagnostics. The existing collector/normalizer pipeline handles the new Reports applications, while the dashboard receives a source-health model independently from event data. Settings removes the now-complete Firestore migration action and procedure.

**Tech Stack:** TypeScript, Vitest, tRPC, React, Firestore REST API, Google Admin Reports API.

**Spec:** `docs/superpowers/specs/2026-09-18-google-workspace-audit-visibility-design.md`

## Global Constraints

- Keep Google Workspace access read-only and preserve existing events/checkpoints.
- Persist only status, counts, timestamps and closed safe error codes; never raw upstream errors or credentials.
- Do not change Firestore data outside existing Fluxora paths.
- One source failure must not block another source.
- Remove the Firestore migration control but retain the organized data layer.

---

### Task 1: Define safe source diagnostics

**Files:**
- Modify: `server/googleWorkspace/types.ts`
- Modify: `server/googleWorkspace/sync.ts`
- Test: `server/googleWorkspace/sync.test.ts`

**Interfaces:**
- Produce `WorkspaceSourceStatus` with `status`, `collected`, `persisted`, `attemptedAt`, `completedAt` and optional `safeError`.
- `safeError` is restricted to `permission`, `configuration` or `unknown`; success with zero collection uses `empty`.

- [ ] **Step 1: Write failing status tests**

```ts
expect(summary.sources.login).toMatchObject({ status: "empty", collected: 0, persisted: 0 });
expect(summary.sources.admin).toMatchObject({ status: "failure", safeError: "permission" });
```

- [ ] **Step 2: Run the focused test**

Run: `npm test -- --run server/googleWorkspace/sync.test.ts`

Expected: FAIL because the coordinator only returns `success` or `failure`.

- [ ] **Step 3: Implement closed safe status classification**

Map successful zero-result sources to `empty`; map HTTP authorization failures to `permission`; map missing Workspace configuration to `configuration`; map all remaining failures to `unknown`. Store no raw message.

- [ ] **Step 4: Re-run the focused test**

Run: `npm test -- --run server/googleWorkspace/sync.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/googleWorkspace/types.ts server/googleWorkspace/sync.ts server/googleWorkspace/sync.test.ts
git commit -m "feat: classify Workspace audit source status"
```

### Task 2: Persist source diagnostics with checkpoints

**Files:**
- Modify: `server/googleWorkspace/repository.ts`
- Modify: `server/googleWorkspace/repository.test.ts`
- Modify: `server/googleWorkspace/runtime.ts`
- Test: `server/googleWorkspace/runtime.test.ts`

**Interfaces:**
- Extend `getSourceState(source)` to return the latest safe diagnostic.
- Extend `saveSourceBatch` or a dedicated safe-state update to persist source status independently of event count.
- Runtime returns the same source diagnostics to the caller after every source completes.

- [ ] **Step 1: Write failing repository/runtime tests**

```ts
expect(adapter.documents.get("fluxora/data/workspace-sync-state/login")).toMatchObject({
  lastStatus: "empty", lastCollected: 0, lastPersisted: 0,
});
expect(summary.sources.login).toMatchObject({ status: "empty" });
```

- [ ] **Step 2: Run focused tests**

Run: `npm test -- --run server/googleWorkspace/repository.test.ts server/googleWorkspace/runtime.test.ts`

Expected: FAIL because no source diagnostic is persisted.

- [ ] **Step 3: Implement safe checkpoint updates**

Persist `lastStatus`, `lastCollected`, `lastPersisted`, `lastAttemptedAt`, `lastCompletedAt` and optional `lastSafeError`. Preserve cursors and successful-event timestamps. On failure, save only the closed safe error code.

- [ ] **Step 4: Re-run focused tests**

Run: `npm test -- --run server/googleWorkspace/repository.test.ts server/googleWorkspace/runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/googleWorkspace/repository.ts server/googleWorkspace/repository.test.ts server/googleWorkspace/runtime.ts server/googleWorkspace/runtime.test.ts
git commit -m "feat: persist Workspace source diagnostics"
```

### Task 3: Add high-value Reports audit sources

**Files:**
- Modify: `server/googleWorkspace/types.ts`
- Modify: `server/googleWorkspace/runtime.ts`
- Modify: `server/googleWorkspace/collectors/reports.ts`
- Test: `server/googleWorkspace/collectors/reports.test.ts`
- Test: `server/googleWorkspace/runtime.test.ts`

**Interfaces:**
- Add source/application mappings for `groups`, `mobile` and `rules`.
- Use the existing Reports collector and normalizer; each retains actor, target, network data when Google supplies it and existing redaction rules.

- [ ] **Step 1: Write failing collector tests**

```ts
expect(normalizeReportsActivity("groups", groupActivity, observedAt)[0]).toMatchObject({ source: "groups", category: "identity" });
expect(normalizeReportsActivity("mobile", deviceActivity, observedAt)[0]).toMatchObject({ source: "mobile", category: "device_security" });
```

- [ ] **Step 2: Run focused tests**

Run: `npm test -- --run server/googleWorkspace/collectors/reports.test.ts server/googleWorkspace/runtime.test.ts`

Expected: FAIL because source/application mappings do not exist.

- [ ] **Step 3: Implement mappings and runtime source list**

Add only `groups`, `mobile` and `rules` to the report application union and source list. Normalize their events through the existing metadata sanitizer and severity logic. Do not add scopes beyond `admin.reports.audit.readonly`.

- [ ] **Step 4: Re-run focused tests**

Run: `npm test -- --run server/googleWorkspace/collectors/reports.test.ts server/googleWorkspace/runtime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/googleWorkspace/types.ts server/googleWorkspace/runtime.ts server/googleWorkspace/collectors/reports.ts server/googleWorkspace/collectors/reports.test.ts server/googleWorkspace/runtime.test.ts
git commit -m "feat: collect additional Workspace audit sources"
```

### Task 4: Expose audit source health in the dashboard

**Files:**
- Modify: `server/googleWorkspace/dashboard.ts`
- Modify: `server/googleWorkspace/dashboard.test.ts`
- Modify: `server/routers.ts`
- Modify: `client/src/pages/WorkspaceSecurity.tsx`

**Interfaces:**
- Dashboard returns `sources: WorkspaceSourceStatus[]` in a stable source order.
- UI renders source, status, counts, latest attempt and a permission/configuration hint without raw errors.

- [ ] **Step 1: Write a failing dashboard test**

```ts
expect(dashboard.sources).toContainEqual(expect.objectContaining({ source: "login", status: "empty" }));
```

- [ ] **Step 2: Run the focused test**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Expected: FAIL because dashboard has no source health field.

- [ ] **Step 3: Implement the backend and UI model**

Read checkpoints for all configured sources, append safe diagnostics to the dashboard response, and render a compact source-health card below the summary cards. Keep event filters and detail modal unchanged.

- [ ] **Step 4: Run dashboard test and type check**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/googleWorkspace/dashboard.ts server/googleWorkspace/dashboard.test.ts server/routers.ts client/src/pages/WorkspaceSecurity.tsx
git commit -m "feat: show Workspace audit source health"
```

### Task 5: Remove the completed Firestore migration control

**Files:**
- Modify: `client/src/pages/Settings.tsx`
- Modify: `server/routers.ts`
- [ ] **Step 1: Locate the completed control surface**

Run: `rg -n "migrateFluxoraFirestore|migrateFluxoraData|Organização do Firestore" client/src/pages/Settings.tsx server/routers.ts`

Expected: the hook, handler, UI card and administrative mutation are present.

- [ ] **Step 2: Remove only the Settings card and its migration mutation**

Remove the card, mutation hook, click handler and `migrateAllFluxoraCollections` router import/procedure. Leave the data registry and migration implementation untouched.

- [ ] **Step 3: Verify the completed control is absent and type check**

Run: `rg -n "migrateFluxoraFirestore|migrateFluxoraData|Organização do Firestore" client/src/pages/Settings.tsx server/routers.ts`

Expected: no results.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Settings.tsx server/routers.ts
git commit -m "chore: remove completed Firestore migration control"
```

### Task 6: Verify the complete audit flow

**Files:**
- Modify only files required by failing verification.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 2: Run type check and production build**

Run: `npm run check`

Run: `npm run build:vercel`

Expected: both pass.

- [ ] **Step 3: Inspect scope**

Run: `git diff --check`

Expected: no whitespace errors and no Firestore collection changes outside Fluxora paths.

- [ ] **Step 4: Commit only verification fixes**

Do not create an empty commit.
