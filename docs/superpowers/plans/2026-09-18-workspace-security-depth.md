# Google Workspace Security Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a resumable 90-day Google Workspace audit, richer security classification and actionable posture dashboard without materially increasing Vercel Hobby Fluid Active CPU.

**Architecture:** Extend the existing collectors with explicit time ranges and deterministic page/event budgets, then persist a per-source backfill checkpoint in the existing Workspace sync-state collection. Keep daily incremental collection first, advance bounded backfill work only within a shared deadline, and expose stored diagnostics through paginated dashboard queries so requests never scan the full history.

**Tech Stack:** TypeScript, Vitest, Express/tRPC, React, TanStack Query, Firestore REST adapter, Google Workspace Reports/Directory/Alert Center APIs, Vercel Functions and Cron.

**Spec:** `docs/superpowers/specs/2026-09-18-workspace-security-depth-design.md`

## Global Constraints

- The historical target is exactly 90 days and backfill windows are 24 hours.
- Keep the existing once-daily Vercel cron and the existing 300-second function configuration.
- Add no paid service, worker, queue, database or production dependency.
- Bound pages, normalized events, Firestore writes and correlation reads on every invocation.
- Google access remains read-only; never store message bodies, document contents, credentials, tokens or raw upstream errors.
- Preserve deterministic event IDs and existing events/checkpoints.
- Do not deploy, mutate environment variables or change Workspace privileges.

---

### Task 1: Bounded collector results and 90-day window planner

**Files:**
- Create: `server/googleWorkspace/backfill.ts`
- Create: `server/googleWorkspace/backfill.test.ts`
- Modify: `server/googleWorkspace/client.ts`
- Modify: `server/googleWorkspace/client.test.ts`
- Modify: `server/googleWorkspace/collectors/reports.ts`
- Modify: `server/googleWorkspace/collectors/reports.test.ts`
- Modify: `server/googleWorkspace/collectors/alertCenter.ts`
- Modify: `server/googleWorkspace/collectors/alertCenter.test.ts`

**Interfaces:**
- Produces `planWorkspaceBackfillWindow(input: { targetStart: Date; targetEnd: Date; coveredThrough?: Date; windowMs?: number }): { start: Date; end: Date; complete: boolean }`.
- Produces `GoogleWorkspacePaginationOptions.maxPages` and `GoogleWorkspacePaginationOptions.startPageToken`.
- Produces `CollectedWorkspaceEvidence { events; nextPageToken?; pagesRead; truncated }` from both event collectors.

- [ ] **Step 1: Write failing planner tests**

```ts
expect(planWorkspaceBackfillWindow({
  targetStart: new Date("2026-06-20T00:00:00Z"),
  targetEnd: new Date("2026-09-18T00:00:00Z"),
  coveredThrough: new Date("2026-06-20T00:00:00Z"),
})).toEqual({
  start: new Date("2026-06-20T00:00:00Z"),
  end: new Date("2026-06-21T00:00:00Z"),
  complete: false,
});
```

- [ ] **Step 2: Run `pnpm vitest run server/googleWorkspace/backfill.test.ts` and verify failure because the planner is absent**

- [ ] **Step 3: Implement the pure 24-hour planner with clamping at the current target end supplied by the caller**

```ts
export const WORKSPACE_BACKFILL_DAYS = 90;
export const WORKSPACE_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1_000;

export function planWorkspaceBackfillWindow(input: BackfillWindowInput): BackfillWindow {
  const start = input.coveredThrough ?? input.targetStart;
  const end = new Date(Math.min(start.getTime() + (input.windowMs ?? WORKSPACE_BACKFILL_WINDOW_MS), input.targetEnd.getTime()));
  return { start, end, complete: start >= input.targetEnd };
}
```

- [ ] **Step 4: Add failing client tests proving `maxPages: 2` stops before a third request and returns the last page token through an `onPage` callback**

- [ ] **Step 5: Run `pnpm vitest run server/googleWorkspace/client.test.ts` and verify the new test fails**

- [ ] **Step 6: Add `maxPages`, `startPageToken` and `onPage` to pagination while retaining cycle protection**

- [ ] **Step 7: Add failing collector tests for explicit `startTime`, `endTime`, two-page limits and a 500-event limit**

- [ ] **Step 8: Run both collector test files and verify failures are caused by the missing bounded result**

- [ ] **Step 9: Return `CollectedWorkspaceEvidence` and stop normalization once `maxEvents` is reached; set `truncated` and preserve the continuation token**

- [ ] **Step 10: Run the four focused test files and verify they pass**

### Task 2: Persist resumable source coverage and acquire a distributed lease

**Files:**
- Modify: `server/googleWorkspace/types.ts`
- Modify: `server/googleWorkspace/repository.ts`
- Modify: `server/googleWorkspace/repository.test.ts`

**Interfaces:**
- Produces `WorkspaceSourceState` with `backfillTargetStart`, `backfillTargetEnd`, `backfillCoveredThrough`, `backfillPageToken`, `rangeStart`, `rangeEnd` and diagnostics.
- Produces `tryAcquireSyncLease(owner: string, expiresAt: Date): Promise<boolean>` and `releaseSyncLease(owner: string): Promise<void>`.
- Extends `saveSourceBatch` so checkpoint and events remain atomic in the final batch.

- [ ] **Step 1: Add failing repository tests for storing and reading backfill coverage, page token and consulted range**

```ts
await repository.saveSourceBatch({
  source: "login",
  events: [],
  attemptedAt: now.toISOString(),
  backfill: { targetStart, targetEnd, coveredThrough, pageToken: "next" },
  range: { start, end },
});
expect(await repository.getSourceState("login")).toMatchObject({
  backfillCoveredThrough: coveredThrough,
  backfillPageToken: "next",
});
```

- [ ] **Step 2: Run the repository test and verify failure due to missing fields**

- [ ] **Step 3: Implement typed state serialization and parsing without changing existing checkpoint semantics**

- [ ] **Step 4: Add failing lease tests: first owner acquires, second owner is rejected, expired lease can be replaced, wrong owner cannot release**

- [ ] **Step 5: Run tests and verify lease tests fail**

- [ ] **Step 6: Extend `server/firestore.ts` and the repository adapter with Firestore write preconditions, then implement lease expiry and ownership checks in one document named `coordinator` using compare-and-set**

- [ ] **Step 7: Run `pnpm vitest run server/googleWorkspace/repository.test.ts` and verify all repository tests pass**

### Task 3: Add prioritized Reports sources and security-aware normalization

**Files:**
- Modify: `server/googleWorkspace/types.ts`
- Modify: `server/googleWorkspace/normalizers/reports.ts`
- Modify: `server/googleWorkspace/collectors/reports.ts`
- Modify: `server/googleWorkspace/collectors/reports.test.ts`
- Modify: `server/googleWorkspace/config.test.ts`

**Interfaces:**
- Extends sources with `gmail`, `user_accounts`, `saml`, `calendar`, `chat` and `meet`.
- `severityFor` recognizes 2SV disablement, role/privilege changes, suspicious OAuth, external/public Drive access and Google rule severity.

- [ ] **Step 1: Add table-driven failing normalization tests for each new source and high-value event**

```ts
expect(normalizeReportsActivity("login", activity("2sv_disable"), now)[0]).toMatchObject({ severity: "high", category: "identity" });
expect(normalizeReportsActivity("rules", activity("rule_trigger", [{ name: "severity", value: "HIGH" }]), now)[0]).toMatchObject({ severity: "high", category: "security_policy" });
expect(normalizeReportsActivity("drive", activity("change_user_access", [{ name: "visibility", value: "shared_externally" }]), now)[0]).toMatchObject({ severity: "high" });
```

- [ ] **Step 2: Run the Reports tests and verify failures for unsupported names or wrong severity**

- [ ] **Step 3: Extend the source/application unions, allowed applications and category mapping; preserve the single audit-readonly scope**

- [ ] **Step 4: Implement explicit severity predicates and default routine activity to `informational` rather than `medium`**

- [ ] **Step 5: Run Reports and config tests and verify they pass**

### Task 4: Coordinate incremental sync, bounded backfill and incremental findings

**Files:**
- Modify: `server/googleWorkspace/sync.ts`
- Modify: `server/googleWorkspace/sync.test.ts`
- Modify: `server/googleWorkspace/runtime.ts`
- Modify: `server/googleWorkspace/runtime.test.ts`
- Modify: `server/googleWorkspace/correlation.ts`
- Modify: `server/googleWorkspace/correlation.test.ts`

**Interfaces:**
- `syncGoogleWorkspaceSecurity(options?: { trigger?: "scheduled" | "manual"; continueBackfill?: boolean })`.
- Runtime summary adds `coverage`, `budget` and `backfill` while preserving existing `status` and `sources`.
- Correlation accepts only the affected range plus a bounded look-behind query.

- [ ] **Step 1: Add a failing runtime test proving a new source receives an incremental range and only one 24-hour backfill window**

- [ ] **Step 2: Add a failing runtime test proving a truncated page stores its token without advancing `coveredThrough`**

- [ ] **Step 3: Add a failing runtime test proving deadline exhaustion returns `partial` and skips remaining backfill work**

- [ ] **Step 4: Run runtime tests and verify all three fail for the intended missing behavior**

- [ ] **Step 5: Implement the coordinator with constants `MAX_PAGES_PER_SOURCE = 2`, `MAX_EVENTS_PER_SOURCE = 500`, `MAX_BACKFILL_WINDOWS_PER_RUN = 4` and `EXECUTION_BUDGET_MS = 240_000`**

- [ ] **Step 6: Add failing correlation tests for 2SV disabled, privilege escalation, risky OAuth, external Drive sharing and high-severity DLP**

- [ ] **Step 7: Run correlation tests and verify failures**

- [ ] **Step 8: Extend `WorkspaceFindingRule` and implement deterministic single-event findings for those high-confidence signals; query only `affectedStart - CORRELATION_WINDOW_MS` through the new events' maximum time**

- [ ] **Step 9: Run sync, runtime and correlation tests and verify they pass**

### Task 5: Persist actionable directory posture without sensitive content

**Files:**
- Modify: `server/googleWorkspace/collectors/directory.ts`
- Modify: `server/googleWorkspace/collectors/directory.test.ts`
- Modify: `server/googleWorkspace/normalizers/directory.ts`
- Modify: `server/googleWorkspace/repository.ts`
- Modify: `server/googleWorkspace/repository.test.ts`

**Interfaces:**
- Directory users request only `id,primaryEmail,name(fullName),orgUnitPath,suspended,isEnrolledIn2Sv`.
- Posture stores bounded `withoutTwoStepVerificationUsers` and `suspendedUsers` entries with `id`, `email`, `displayName`, `orgUnitPath`, `suspended` and `twoStepEnrolled`.

- [ ] **Step 1: Add a failing collector test asserting the exact allowlisted Directory fields and normalized remediation entries**

- [ ] **Step 2: Run directory tests and verify failure because details are absent**

- [ ] **Step 3: Implement safe mapping, deterministic sorting and a maximum of 500 entries per posture category; retain aggregate counts for all users**

- [ ] **Step 4: Add a failing repository test proving `previousUsers` aggregates are kept when the current snapshot replaces the prior one**

- [ ] **Step 5: Implement the current/previous aggregate transition in the posture document**

- [ ] **Step 6: Run directory and repository tests and verify they pass**

### Task 6: Paginated dashboard API and coverage diagnostics

**Files:**
- Modify: `server/googleWorkspace/dashboard.ts`
- Modify: `server/googleWorkspace/dashboard.test.ts`
- Modify: `server/routers.ts`
- Modify: `server/routers.test.ts`

**Interfaces:**
- `getWorkspaceSecurityDashboard(input: { period: "24h" | "7d" | "30d" | "90d"; source?: WorkspaceSecuritySource; severity?: SecuritySeverity; category?: string; pageSize: number; cursor?: string })`.
- Response adds `eventPage { items; nextCursor }`, `coverage`, detailed posture entries and actionable source guidance.
- Adds admin mutation `workspaceSecurity.continueBackfill` using the same bounded coordinator.

- [ ] **Step 1: Add failing dashboard tests for coverage percentage, freshness, posture details and opaque next cursor**

- [ ] **Step 2: Run dashboard tests and verify failures**

- [ ] **Step 3: Implement validated bounded Firestore queries with `pageSize <= 100`; derive coverage from stored checkpoints rather than event scans**

- [ ] **Step 4: Add failing router tests proving overview bounds page size and only administrators can continue backfill**

- [ ] **Step 5: Implement the tRPC input schemas and admin mutation; keep the existing Settings sync mutation compatible**

- [ ] **Step 6: Run dashboard and router tests and verify they pass**

### Task 7: Workspace Security interface

**Files:**
- Modify: `client/src/pages/WorkspaceSecurity.tsx`
- Create: `client/src/pages/WorkspaceSecurity.test.tsx`

**Interfaces:**
- Uses paginated overview input and `continueBackfill` mutation.
- Presents coverage, source diagnostics, posture details, filters and incremental event loading.

- [ ] **Step 1: Add failing component tests for 90-day coverage, a partial-source explanation, administrator continuation and detailed posture lists**

- [ ] **Step 2: Run the component test and verify failure because the controls are absent**

- [ ] **Step 3: Replace the fixed event list with period/source/severity/category query inputs and a `Carregar mais` control**

- [ ] **Step 4: Add coverage progress, consulted ranges, freshness and closed-status guidance to source cards**

- [ ] **Step 5: Add expandable 2SV and suspended-user posture sections and keep personal data out of summary cards**

- [ ] **Step 6: Add administrator-only `Continuar histórico` with pending, success and safe failure feedback**

- [ ] **Step 7: Run the component test and verify it passes**

### Task 8: Focused and production verification

**Files:**
- Modify only files required to correct failures introduced by Tasks 1–7.

**Interfaces:**
- No new interface; validates the completed implementation.

- [ ] **Step 1: Run `pnpm vitest run server/googleWorkspace client/src/pages/WorkspaceSecurity.test.tsx` and verify all focused tests pass**

- [ ] **Step 2: Run `pnpm check` and fix only errors caused by this implementation**

- [ ] **Step 3: Run `pnpm build` and verify the production bundle succeeds**

- [ ] **Step 4: Inspect `git diff --check` and `git status --short`; confirm no unrelated file was modified**

- [ ] **Step 5: Report implemented behavior, verification results and any Google edition/permission limitations; do not deploy or commit**
