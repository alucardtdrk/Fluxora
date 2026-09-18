# Workspace Security Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect and present correlated Google Workspace security findings from Alert Center, login, administrative, OAuth and Drive evidence, without storing unsafe content or sending notifications.

**Architecture:** Keep event collection read-only and enrich it with a bounded set of safe phishing fields. After each Workspace synchronization, query recent persisted events, evaluate deterministic correlation rules, and upsert deduplicated findings in Firestore. The existing dashboard endpoint returns findings alongside events and posture; the Workspace Security page renders a prioritized findings view and details timeline.

**Tech Stack:** TypeScript, Vitest, tRPC, React, Firestore REST API, Vite, Tailwind/shadcn UI.

**Spec:** `docs/superpowers/specs/2026-09-17-workspace-security-correlation-design.md`

## Global Constraints

- Google Workspace access stays read-only; never call a mutating Google API.
- Use the daily Vercel cron and existing manual synchronization only; do not add real-time infrastructure.
- Never persist or render email bodies, message content, attachments, or raw Google payloads.
- Persist only bounded safe fields: reporter email, suspected sender, subject summary, affected users, indicator URLs and attachment names when Google provides them.
- Absent optional Google fields must render as “Não disponibilizado pelo Google”.
- Findings expire with their source evidence and must be deduplicated by deterministic fingerprint.
- Notifications are explicitly out of scope.

---

## File structure

- Create: `server/googleWorkspace/correlation.ts` — pure finding types, rule evaluation and fingerprinting.
- Create: `server/googleWorkspace/correlation.test.ts` — positive, negative and deduplication tests for every correlation rule.
- Modify: `server/googleWorkspace/types.ts` — safe event-detail and finding contracts.
- Modify: `server/googleWorkspace/normalizers/alertCenter.ts` — whitelist phishing fields from Google Alert Center data.
- Modify: `server/googleWorkspace/collectors/alertCenter.test.ts` — prove safe phishing field extraction and redaction behavior.
- Modify: `server/googleWorkspace/repository.ts` — read/write finding records and query recent event records through an injected adapter.
- Modify: `server/googleWorkspace/repository.test.ts` — verify finding persistence and bounded recent-event retrieval.
- Modify: `server/googleWorkspace/runtime.ts` — run correlation after collection and save findings without making source collection mutable.
- Modify: `server/googleWorkspace/runtime.test.ts` and `server/googleWorkspace/sync.test.ts` — verify orchestration and safe correlation-failure handling.
- Modify: `server/googleWorkspace/dashboard.ts` and `server/googleWorkspace/dashboard.test.ts` — expose sanitized findings and safe event details to tRPC.
- Modify: `client/src/pages/WorkspaceSecurity.tsx` — render findings, filters, details and explicit unavailable-field copy.

## Correlation constants

Use these fixed, testable thresholds in `server/googleWorkspace/correlation.ts`:

```ts
export const CORRELATION_WINDOW_MS = 24 * 60 * 60 * 1_000;
export const DISTRIBUTED_LOGIN_WINDOW_MS = 30 * 60 * 1_000;
export const MIN_DISTRIBUTED_LOGIN_FAILURES = 3;

export type WorkspaceFindingRule =
  | "distributed_login_failures"
  | "suspicious_login_then_oauth"
  | "admin_change_then_identity_risk"
  | "drive_activity_after_identity_risk"
  | "repeated_phishing_or_malware";
```

The correlation input contains only recent `WorkspaceSecurityEvent` records. Findings use a UTC date bucket derived from the earliest evidence timestamp. The stable fingerprint is a new `workspaceSecurityFindingId(rule, subject, bucket)` helper in `correlation.ts`, implemented with Node `createHash("sha256")` over the three values. Do not widen `workspaceSecurityEventId`, whose source parameter intentionally accepts only event sources.

### Task 1: Add safe phishing details to normalized events

**Files:**
- Modify: `server/googleWorkspace/types.ts`
- Modify: `server/googleWorkspace/normalizers/alertCenter.ts`
- Modify: `server/googleWorkspace/collectors/alertCenter.test.ts`

**Interfaces:**
- Produces `WorkspaceSecurityEvent.safeDetails?: WorkspaceSecuritySafeDetails`.
- `WorkspaceSecuritySafeDetails` contains only `reporterEmail`, `suspectedSender`, `subject`, `affectedUsers`, `indicatorUrls`, and `attachmentNames`; every value is optional and bounded.

- [ ] **Step 1: Write the failing phishing-detail test**

Add a `MailPhishing` fixture with whitelisted fields and a raw body field. Assert that the output has the selected fields and does not include the body:

```ts
it("keeps only safe phishing details", () => {
  const normalized = normalizeAlertCenterAlert({
    ...phishingAlert,
    data: {
      "@type": "type.googleapis.com/google.apps.alertcenter.type.MailPhishing",
      reporterEmail: "reporter@example.com",
      maliciousEntity: { fromHeader: "attacker@example.net", subject: "Urgente" },
      affectedUserEmails: ["employee@example.com"],
      urls: ["https://phishing.example"],
      attachments: ["invoice.zip"],
      messageBody: "never persist this",
    },
  }, new Date("2026-09-16T10:10:00.000Z"));

  expect(normalized?.safeDetails).toEqual({
    reporterEmail: "reporter@example.com",
    suspectedSender: "attacker@example.net",
    subject: "Urgente",
    affectedUsers: ["employee@example.com"],
    indicatorUrls: ["https://phishing.example"],
    attachmentNames: ["invoice.zip"],
  });
  expect(JSON.stringify(normalized)).not.toContain("never persist this");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- --run server/googleWorkspace/collectors/alertCenter.test.ts`

Expected: FAIL because `safeDetails` does not exist.

- [ ] **Step 3: Add the minimal safe-details contract and extractor**

In `types.ts`, add a readonly `WorkspaceSecuritySafeDetails` interface and `safeDetails?: WorkspaceSecuritySafeDetails` to `WorkspaceSecurityEvent`. In `alertCenter.ts`, add a helper that only reads explicit scalar/array paths and caps each list at 20 values and each string at the existing 2,000-character limit:

```ts
function phishingSafeDetails(data: Readonly<Record<string, unknown>>) {
  const entity = data.maliciousEntity as Record<string, unknown> | undefined;
  const details = {
    reporterEmail: text(data.reporterEmail) ?? text(data.reportedBy),
    suspectedSender: text(entity?.fromHeader) ?? text(data.senderEmail),
    subject: text(entity?.subject) ?? text(data.subject),
    affectedUsers: stringList(data.affectedUserEmails),
    indicatorUrls: stringList(data.urls),
    attachmentNames: stringList(data.attachments),
  };
  return Object.values(details).some(Boolean) ? details : undefined;
}
```

Only attach it when the Alert Center data type is `MailPhishing`; do not copy arbitrary data keys into `safeDetails`.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- --run server/googleWorkspace/collectors/alertCenter.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the safe field extraction**

```bash
git add server/googleWorkspace/types.ts server/googleWorkspace/normalizers/alertCenter.ts server/googleWorkspace/collectors/alertCenter.test.ts
git commit -m "feat: enrich safe phishing alert details"
```

### Task 2: Implement pure correlation rules and findings

**Files:**
- Create: `server/googleWorkspace/correlation.ts`
- Create: `server/googleWorkspace/correlation.test.ts`
- Modify: `server/googleWorkspace/types.ts`

**Interfaces:**
- Produces `WorkspaceSecurityFinding` with `id`, `rule`, `severity`, `title`, `description`, `subjects`, `ipAddresses`, `eventIds`, `firstOccurredAt`, `lastOccurredAt`, `evidenceCount`, and `expiresAt`.
- Exports `correlateWorkspaceSecurityEvents(events, now): readonly WorkspaceSecurityFinding[]`.

- [ ] **Step 1: Write failing tests for the five rules and deduplication**

Create fixtures using real `WorkspaceSecurityEvent` objects. Include these assertions:

```ts
expect(correlateWorkspaceSecurityEvents(distributedLoginEvents, now)).toEqual([
  expect.objectContaining({ rule: "distributed_login_failures", severity: "high", subjects: ["ana@example.com"] }),
]);
expect(correlateWorkspaceSecurityEvents(loginThenOauthEvents, now)[0]).toMatchObject({
  rule: "suspicious_login_then_oauth", severity: "high",
});
expect(correlateWorkspaceSecurityEvents(adminThenRiskEvents, now)[0]?.rule).toBe("admin_change_then_identity_risk");
expect(correlateWorkspaceSecurityEvents(driveAfterRiskEvents, now)[0]?.rule).toBe("drive_activity_after_identity_risk");
expect(correlateWorkspaceSecurityEvents(repeatedPhishingEvents, now)[0]?.rule).toBe("repeated_phishing_or_malware");
expect(correlateWorkspaceSecurityEvents([singleLoginFailure], now)).toEqual([]);
expect(correlateWorkspaceSecurityEvents([...distributedLoginEvents, ...distributedLoginEvents], now)).toHaveLength(1);
```

- [ ] **Step 2: Run the focused correlation test and verify it fails**

Run: `npm test -- --run server/googleWorkspace/correlation.test.ts`

Expected: FAIL because the module and function do not exist.

- [ ] **Step 3: Add the finding type and minimal deterministic rules**

Implement `correlateWorkspaceSecurityEvents` as a pure function. Sort events by `occurredAt`, retain only events within `CORRELATION_WINDOW_MS`, and use an event ID set before rule evaluation. For every generated finding, derive:

```ts
const id = workspaceSecurityFindingId(rule, subject, utcDateBucket);
const expiresAt = new Date(Math.min(...evidence.map((event) => event.expiresAt.getTime())));
```

Use these exact predicates:

```ts
// distributed_login_failures: same actor, >= 3 login events whose type includes
// "failure", at least 2 distinct non-empty IPs or countries, within 30 minutes.
// suspicious_login_then_oauth: a high/critical login followed within 24h by an
// oauth_token event for the same actor.
// admin_change_then_identity_risk: high/critical admin event plus high/critical
// login or alert_center identity event for the same actor or target within 24h.
// drive_activity_after_identity_risk: high/critical drive event plus high/critical
// login, oauth_token or identity alert for the same actor within 24h.
// repeated_phishing_or_malware: >= 3 alert_center events whose type/category
// contains phishing or malware and share target, reporterEmail or suspectedSender within 24h.
```

Deduplicate with a `Map<string, WorkspaceSecurityFinding>` keyed by `id`; merge evidence IDs, subjects/IPs and timestamp bounds before returning sorted by severity then latest occurrence.

- [ ] **Step 4: Run the focused correlation test and verify it passes**

Run: `npm test -- --run server/googleWorkspace/correlation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the correlation engine**

```bash
git add server/googleWorkspace/types.ts server/googleWorkspace/correlation.ts server/googleWorkspace/correlation.test.ts
git commit -m "feat: correlate Workspace security events"
```

### Task 3: Persist findings and read recent evidence

**Files:**
- Modify: `server/googleWorkspace/repository.ts`
- Modify: `server/googleWorkspace/repository.test.ts`

**Interfaces:**
- Produces `WORKSPACE_SECURITY_FINDINGS_COLLECTION`.
- Adds `saveFindings(findings)` and `listRecentEvents(since: Date)` to `createGoogleWorkspaceRepository`.
- Extends `WorkspaceFirestoreAdapter` with `queryEvents?(since: Date): Promise<readonly FirestoreRecord[]>` so repository tests remain network-free.

- [ ] **Step 1: Write failing repository tests**

Add a fake adapter implementing `queryEvents` and assert both behaviors:

```ts
await repository.saveFindings([finding]);
expect(adapter.commits[0]).toEqual(expect.arrayContaining([
  expect.objectContaining({ collection: WORKSPACE_SECURITY_FINDINGS_COLLECTION, id: finding.id }),
]));
await expect(repository.listRecentEvents(new Date("2026-09-17T00:00:00.000Z"))).resolves.toEqual([eventRecord]);
```

- [ ] **Step 2: Run the focused repository test and verify it fails**

Run: `npm test -- --run server/googleWorkspace/repository.test.ts`

Expected: FAIL because the collection and repository methods do not exist.

- [ ] **Step 3: Add finding write and recent-event query support**

Add the finding collection constant. Save findings in batches of at most 499 using the existing `commit` adapter. Implement the default recent-event reader with `runFirestoreQuery` and an `occurredAt >= since` filter, selecting only fields needed by the correlator: event identity, source, category, type, severity, timestamps, actor, target, IP, country, safe details and expiry.

```ts
async listRecentEvents(since: Date) {
  return adapter.queryEvents
    ? adapter.queryEvents(since)
    : runFirestoreQuery({
        from: [{ collectionId: WORKSPACE_SECURITY_EVENTS_COLLECTION }],
        where: { fieldFilter: { field: { fieldPath: "occurredAt" }, op: "GREATER_THAN_OR_EQUAL", value: { timestampValue: since.toISOString() } } },
        orderBy: [{ field: { fieldPath: "occurredAt" }, direction: "ASCENDING" }],
        limit: 1000,
      });
}
```

- [ ] **Step 4: Run the focused repository test and verify it passes**

Run: `npm test -- --run server/googleWorkspace/repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit finding persistence**

```bash
git add server/googleWorkspace/repository.ts server/googleWorkspace/repository.test.ts
git commit -m "feat: persist Workspace security findings"
```

### Task 4: Run correlation after each scheduled or manual sync

**Files:**
- Modify: `server/googleWorkspace/runtime.ts`
- Modify: `server/googleWorkspace/runtime.test.ts`
- Modify: `server/googleWorkspace/sync.ts`
- Modify: `server/googleWorkspace/sync.test.ts`

**Interfaces:**
- `createGoogleWorkspaceSecuritySync` accepts injected `correlate` and repository methods `listRecentEvents`/`saveFindings`.
- `WorkspaceSyncSummary` gains `findings: { generated: number; persisted: number; safeError?: "correlation" }`.

- [ ] **Step 1: Write failing runtime tests for success and safe failure**

Use injected collectors, repository and correlator. Assert the correlator receives events no older than `CORRELATION_WINDOW_MS`, and its results are saved:

```ts
const result = await sync.run();
expect(repository.listRecentEvents).toHaveBeenCalledWith(new Date("2026-09-16T12:00:00.000Z"));
expect(repository.saveFindings).toHaveBeenCalledWith([finding]);
expect(result.findings).toEqual({ generated: 1, persisted: 1 });
```

Add a test where correlation throws and assert source statuses remain unchanged while `result.findings.safeError === "correlation"`.

- [ ] **Step 2: Run the focused runtime tests and verify they fail**

Run: `npm test -- --run server/googleWorkspace/runtime.test.ts server/googleWorkspace/sync.test.ts`

Expected: FAIL because finding orchestration is absent.

- [ ] **Step 3: Add minimal orchestration after source synchronization**

After `createWorkspaceSync(...).run()` settles, call the repository reader with `new Date(now().getTime() - CORRELATION_WINDOW_MS)`, map Firestore records back to typed safe events, call `correlate`, and persist findings. Catch only the correlation block and set `safeError: "correlation"`; do not manufacture a security finding from an integration failure.

```ts
const summary = await sourceSync.run();
try {
  const events = await repository.listRecentEvents(new Date(now().getTime() - CORRELATION_WINDOW_MS));
  const findings = correlate(events, now());
  await repository.saveFindings(findings);
  return { ...summary, findings: { generated: findings.length, persisted: findings.length } };
} catch {
  return { ...summary, findings: { generated: 0, persisted: 0, safeError: "correlation" } };
}
```

- [ ] **Step 4: Run the focused runtime tests and verify they pass**

Run: `npm test -- --run server/googleWorkspace/runtime.test.ts server/googleWorkspace/sync.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit synchronization orchestration**

```bash
git add server/googleWorkspace/runtime.ts server/googleWorkspace/runtime.test.ts server/googleWorkspace/sync.ts server/googleWorkspace/sync.test.ts
git commit -m "feat: generate findings after Workspace sync"
```

### Task 5: Extend the dashboard response with safe details and findings

**Files:**
- Modify: `server/googleWorkspace/dashboard.ts`
- Modify: `server/googleWorkspace/dashboard.test.ts`

**Interfaces:**
- `WorkspaceSecurityDashboard` gains `findings` and `summary.openFindings`.
- Each dashboard event exposes `safeDetails?: WorkspaceSecuritySafeDetails`; it never exposes `metadata`.
- Add `WorkspaceDashboardFinding` containing the finding display fields plus source event IDs.

- [ ] **Step 1: Write failing dashboard tests**

Pass a phishing event containing `safeDetails` and a finding record through injected dependencies. Assert that both are returned, while raw metadata is absent:

```ts
expect(dashboard.events[0]?.safeDetails).toMatchObject({ reporterEmail: "reporter@example.com" });
expect(dashboard.events[0]).not.toHaveProperty("metadata");
expect(dashboard.findings[0]).toMatchObject({ rule: "suspicious_login_then_oauth", evidenceCount: 2 });
expect(dashboard.summary.openFindings).toBe(1);
```

- [ ] **Step 2: Run the focused dashboard test and verify it fails**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Expected: FAIL because findings and safe details are not mapped.

- [ ] **Step 3: Map only the dashboard-safe records**

Add finding list dependency and Firestore reader for `WORKSPACE_SECURITY_FINDINGS_COLLECTION`, ordered by last occurrence descending. Add `safeDetails` to the explicit event select list and map it through a validating helper that accepts only the six whitelisted keys. Add `findings` to the empty dashboard response and calculate `openFindings` as every persisted finding returned by the query.

- [ ] **Step 4: Run the focused dashboard test and verify it passes**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit dashboard contract changes**

```bash
git add server/googleWorkspace/dashboard.ts server/googleWorkspace/dashboard.test.ts
git commit -m "feat: expose safe Workspace security findings"
```

### Task 6: Add findings and safer missing-value states to the Workspace Security page

**Files:**
- Modify: `client/src/pages/WorkspaceSecurity.tsx`

**Interfaces:**
- Consumes `dashboard.data.findings`, `events[].safeDetails`, and `summary.openFindings` from the existing `workspaceSecurity.overview` tRPC query.

- [ ] **Step 1: Add the failing UI behavior check**

Add a focused manual acceptance checklist to the task branch, run after starting the existing app:

```text
1. Workspace Security shows “Requer atenção” when the API returns a finding.
2. Clicking a finding opens its rule explanation, users/IPs, time range and linked evidence count.
3. Clicking a linked evidence event opens the existing event dialog.
4. A phishing field not returned by Google reads “Não disponibilizado pelo Google”.
5. No raw `metadata`, body, attachment content or payload JSON is displayed.
```

- [ ] **Step 2: Verify the current page lacks the findings section**

Run: `npm run build:vercel`

Expected: PASS build, with no rendered findings feature yet; use the checklist to record the missing section before implementing it.

- [ ] **Step 3: Add the minimal findings UI and explicit safe-detail copy**

Keep the event table and dialog. Add:

```tsx
<Card className="mt-6 border-0">
  <CardHeader><CardTitle>Requer atenção</CardTitle></CardHeader>
  <CardContent>
    {findings.length === 0 ? <p>Nenhum achado correlacionado no período.</p> : findings.map((finding) => (
      <button key={finding.id} onClick={() => setSelectedFinding(finding)}>
        <span>{severityLabels[finding.severity]}</span>
        <strong>{finding.title}</strong>
        <span>{finding.evidenceCount} evidências relacionadas</span>
      </button>
    ))}
  </CardContent>
</Card>
```

Add a finding dialog showing the rule explanation, subjects, IP addresses, first/last timestamps and event count. In the existing event dialog, render the safe phishing fields only and use `value ?? "Não disponibilizado pelo Google"` for each whitelisted optional field. Do not create a generic metadata renderer.

- [ ] **Step 4: Build and execute the visual acceptance checklist**

Run: `npm run check`

Run: `npm run build:vercel`

Expected: both commands PASS. Verify every manual checklist item against a local or preview deployment with a fixture-backed finding.

- [ ] **Step 5: Commit the Workspace Security interface**

```bash
git add client/src/pages/WorkspaceSecurity.tsx
git commit -m "feat: show correlated Workspace security findings"
```

### Task 7: Run the full verification suite

**Files:**
- Modify only files required by failures discovered during this task.

- [ ] **Step 1: Run all tests**

Run: `npm test`

Expected: all suites PASS, including Alert Center, correlation, repository, runtime, sync and dashboard tests.

- [ ] **Step 2: Run type and production checks**

Run: `npm run check`

Run: `npm run build:vercel`

Expected: both PASS. Existing analytics-environment and bundle-size warnings may remain, but there must be no build failure.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff main...HEAD --check`

Expected: no whitespace errors and no unrelated changes.

- [ ] **Step 4: Commit any narrowly necessary final fixes**

```bash
git add <only-files-fixed-by-verification>
git commit -m "fix: verify Workspace security correlation"
```

Only create this commit if verification required source changes; do not create an empty commit.
