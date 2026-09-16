# Google Workspace Security Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, consultative Google Workspace ingestion foundation that collects audit evidence every 15 minutes, normalizes it, stores it idempotently in Firestore, retains detailed events for six months, and exposes synchronization status inside Fluxora.

**Architecture:** A Vercel Cron invokes one authenticated internal endpoint. That endpoint obtains a delegated Google Workspace token, runs independent collectors for Alert Center, Reports and Directory APIs, normalizes their output into one event contract, and persists events plus per-source cursors in Firestore. Each source commits its cursor only after its events are saved, so partial failures are recoverable without data loss or duplication.

**Tech Stack:** TypeScript, Express, tRPC, Vitest, native `fetch`, `jose`, Firestore REST API, Google Workspace Admin APIs, Vercel Functions and Vercel Cron.

**Spec:** `docs/superpowers/specs/2026-09-15-google-workspace-security-audit-design.md`

## Global Constraints

- This phase is strictly consultative. Google integrations may perform only `GET` requests. Do not suspend users, revoke sessions, delete alerts, alter sharing, or change Workspace configuration.
- Explicitly discard events whose sole meaning is a superadministrator password reset. Keep all other authentication and administrative security events.
- Detailed raw and normalized events expire after 183 days. Synchronization state and directory posture snapshots remain available; incidents and long-term aggregates are introduced in the following plan.
- Credentials live only in Vercel environment variables and must never appear in Firestore, API responses, logs, test snapshots, or browser bundles.
- Alert Center exposes only `https://www.googleapis.com/auth/apps.alerts`, which grants read and write access. Compensating controls are mandatory: GET-only client, a restricted delegated administrator, no generic request method accepting mutations, and tests that reject non-GET operations.
- The 15-minute Vercel schedule requires a Pro or Enterprise Vercel project. Hobby supports only daily schedules. Confirm the production plan before changing `vercel.json`.
- Do not use n8n, Pub/Sub, webhooks, automatic remediation, or user impersonation outside the configured delegated audit administrator in this phase.
- This workspace does not currently contain a project-local Git repository. Never commit into the unrelated parent repository. Each task ends with a verification checkpoint; create commits only after the owner initializes or reconnects the correct project repository.

## File Structure

```text
server/
  googleWorkspace/
    types.ts                 # Shared source, event, cursor and result contracts
    config.ts                # Environment validation and allowed OAuth scopes
    auth.ts                  # Domain-wide delegation JWT and cached access token
    client.ts                # GET-only Google HTTP client, retry and pagination
    retention.ts             # Six-month expiry and bounded cleanup
    repository.ts            # Firestore event, state and posture persistence
    sync.ts                  # Multi-source orchestration and partial-failure handling
    collectors/
      alertCenter.ts         # Alert Center list collection
      reports.ts             # Login, admin, OAuth token and Drive audit collection
      directory.ts           # Users, administrators and 2SV posture snapshot
    normalizers/
      alertCenter.ts         # Alert Center to normalized security event
      reports.ts             # Reports activities to normalized security event
      directory.ts           # Directory resources to posture snapshot
    *.test.ts                # Unit and orchestration tests colocated by concern
  internalAuth.ts            # Shared authorization for internal scheduled routes
api/
  index.ts                   # Internal sync route and health status integration
server/routers.ts            # Protected status and admin-triggered sync procedures
vercel.json                  # 15-minute production cron
README-VERCEL.md             # Deployment variables, Google setup and verification
```

---

## Task 1: Define the security domain and validated configuration

**Files:**
- Create: `server/googleWorkspace/types.ts`
- Create: `server/googleWorkspace/config.ts`
- Test: `server/googleWorkspace/config.test.ts`

- [ ] **Step 1: Write failing configuration and contract tests**

Cover these cases:

```ts
describe("getGoogleWorkspaceConfig", () => {
  it("rejects a missing delegated administrator", () => {});
  it("converts escaped private-key newlines", () => {});
  it("returns only the approved scopes", () => {});
});

describe("security event helpers", () => {
  it("creates a deterministic fingerprint from source and external id", () => {});
  it("marks detailed evidence to expire after 183 days", () => {});
});
```

The exact allowed scopes are:

```ts
export const GOOGLE_WORKSPACE_SCOPES = [
  "https://www.googleapis.com/auth/apps.alerts",
  "https://www.googleapis.com/auth/admin.reports.audit.readonly",
  "https://www.googleapis.com/auth/admin.directory.user.readonly",
  "https://www.googleapis.com/auth/admin.directory.group.readonly",
  "https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
] as const;
```

- [ ] **Step 2: Run the focused test and confirm the expected failure**

Run: `npm test -- server/googleWorkspace/config.test.ts`

Expected: FAIL because `types.ts` and `config.ts` do not exist.

- [ ] **Step 3: Implement the domain contracts**

Define at minimum:

```ts
export type WorkspaceSecuritySource =
  | "alert_center"
  | "login"
  | "admin"
  | "oauth_token"
  | "drive";

export type SecuritySeverity =
  | "critical"
  | "high"
  | "medium"
  | "low"
  | "informational";

export interface WorkspaceSecurityEvent {
  id: string;
  source: WorkspaceSecuritySource;
  externalId: string;
  category: string;
  eventType: string;
  severity: SecuritySeverity;
  title: string;
  description: string;
  occurredAt: string;
  observedAt: string;
  expiresAt: string;
  actorEmail?: string;
  targetEmail?: string;
  ipAddress?: string;
  countryCode?: string;
  metadata: Record<string, unknown>;
}

export interface WorkspaceSyncCursor {
  source: WorkspaceSecuritySource | "directory";
  cursor?: string;
  lastSuccessfulEventAt?: string;
  lastAttemptAt: string;
  lastSuccessAt?: string;
  lastError?: string;
}
```

Add pure helpers for deterministic event IDs and the 183-day expiry calculation. Hash stable canonical input with SHA-256; do not include mutable display text in the ID.

- [ ] **Step 4: Implement strict environment parsing**

Require:

```text
GOOGLE_WORKSPACE_SERVICE_ACCOUNT_EMAIL
GOOGLE_WORKSPACE_PRIVATE_KEY
GOOGLE_WORKSPACE_ADMIN_EMAIL
GOOGLE_WORKSPACE_CUSTOMER_ID
GOOGLE_WORKSPACE_DOMAIN
```

Normalize `\\n` in the private key, validate email/domain/customer ID as non-empty strings, and return an immutable config object. Error messages may name a missing variable but must never include its value.

- [ ] **Step 5: Run verification**

Run: `npm test -- server/googleWorkspace/config.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS with no TypeScript errors.

**Checkpoint:** `types.ts`, `config.ts`, and their focused tests are complete and contain no secret values.

---

## Task 2: Implement delegated authentication with a cached token

**Files:**
- Create: `server/googleWorkspace/auth.ts`
- Test: `server/googleWorkspace/auth.test.ts`

- [ ] **Step 1: Write failing authentication tests**

Use injected `fetch`, clock and signer dependencies. Verify:

```ts
it("builds an assertion for the delegated administrator and approved scopes", async () => {});
it("exchanges the assertion at Google's token endpoint", async () => {});
it("reuses a token until sixty seconds before expiration", async () => {});
it("redacts Google's response body from authentication errors", async () => {});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- server/googleWorkspace/auth.test.ts`

Expected: FAIL because `auth.ts` does not exist.

- [ ] **Step 3: Implement the JWT assertion**

Use `jose` with `RS256`. Claims must be:

```ts
{
  iss: config.serviceAccountEmail,
  sub: config.adminEmail,
  aud: "https://oauth2.googleapis.com/token",
  scope: GOOGLE_WORKSPACE_SCOPES.join(" "),
  iat: nowSeconds,
  exp: nowSeconds + 3600,
}
```

Expose only a `GoogleWorkspaceTokenProvider` interface with `getAccessToken(): Promise<string>`. Keep the assertion and private key private to the module.

- [ ] **Step 4: Implement token exchange and cache**

POST only to the fixed Google OAuth token endpoint. Cache `{ accessToken, expiresAt }` in module memory and renew when fewer than 60 seconds remain. Throw typed errors containing status and a safe category, never the access token, assertion, private key, or raw response body.

- [ ] **Step 5: Run verification**

Run: `npm test -- server/googleWorkspace/auth.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** Domain-wide delegation works through a narrow token-provider interface and secrets are redacted.

---

## Task 3: Add a GET-only Google API client with pagination and bounded retries

**Files:**
- Create: `server/googleWorkspace/client.ts`
- Test: `server/googleWorkspace/client.test.ts`

- [ ] **Step 1: Write failing HTTP-client tests**

Cover:

```ts
it("always performs GET requests", async () => {});
it("follows nextPageToken without repeating a page", async () => {});
it("retries 429 and 5xx responses with bounded backoff", async () => {});
it("does not retry 400, 401 or 403 responses", async () => {});
it("never includes the bearer token in thrown errors", async () => {});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- server/googleWorkspace/client.test.ts`

Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 3: Implement the client**

Expose only:

```ts
interface GoogleWorkspaceClient {
  getJson<T>(url: URL): Promise<T>;
  paginate<T>(options: {
    initialUrl: URL;
    items: (page: T) => readonly unknown[];
    nextPageToken: (page: T) => string | undefined;
    pageTokenParam?: string;
  }): AsyncGenerator<T>;
}
```

Do not expose a generic method, body argument, HTTP method argument, or arbitrary host. Allow only these hosts:

```text
alertcenter.googleapis.com
admin.googleapis.com
```

Retry up to three times for `429`, `500`, `502`, `503`, and `504`, honoring `Retry-After` when present and otherwise using capped exponential backoff. Add a stable user agent identifying Fluxora.

- [ ] **Step 4: Run verification**

Run: `npm test -- server/googleWorkspace/client.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** All Workspace data requests are GET-only, host-restricted, paginated and resilient to temporary Google failures.

---

## Task 4: Persist events, source cursors and posture safely in Firestore

**Files:**
- Create: `server/googleWorkspace/repository.ts`
- Test: `server/googleWorkspace/repository.test.ts`
- Reuse: `server/firestore.ts`

- [ ] **Step 1: Write failing repository tests**

Create an injected Firestore adapter and verify:

```ts
it("upserts the same external event without duplication", async () => {});
it("writes an event batch before advancing its source cursor", async () => {});
it("does not advance the cursor when a batch write fails", async () => {});
it("stores directory posture separately from audit events", async () => {});
it("persists only a safe error summary in synchronization state", async () => {});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- server/googleWorkspace/repository.test.ts`

Expected: FAIL because `repository.ts` does not exist.

- [ ] **Step 3: Implement collection boundaries**

Use these collections:

```text
fluxora_workspace_security_events
fluxora_workspace_sync_state
fluxora_workspace_directory_posture
```

Use the deterministic normalized event ID as the Firestore document ID. Store the normalized event plus `ingestedAt`; never store OAuth tokens, JWT assertions or service-account key material.

- [ ] **Step 4: Implement atomic save semantics**

Expose:

```ts
saveSourceBatch(input: {
  source: WorkspaceSecuritySource;
  events: readonly WorkspaceSecurityEvent[];
  nextCursor?: string;
  lastSuccessfulEventAt?: string;
  attemptedAt: string;
}): Promise<{ insertedOrUpdated: number }>;
```

Use Firestore commit operations so event writes and the successful cursor transition are submitted together. On failure, write only a separate failed-attempt state that leaves the last successful cursor untouched.

- [ ] **Step 5: Run verification**

Run: `npm test -- server/googleWorkspace/repository.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** Reprocessing is idempotent and a failed persistence operation cannot create a false successful cursor.

---

## Task 5: Collect and normalize Alert Center evidence

**Files:**
- Create: `server/googleWorkspace/collectors/alertCenter.ts`
- Create: `server/googleWorkspace/normalizers/alertCenter.ts`
- Test: `server/googleWorkspace/collectors/alertCenter.test.ts`

- [ ] **Step 1: Write fixtures and failing tests**

Include fixtures for account takeover, phishing, data loss and superadministrator password reset. Verify:

```ts
it("paginates alerts from the overlap start time", async () => {});
it("maps an account takeover alert to high or critical severity", async () => {});
it("preserves useful actor, target and alert metadata", async () => {});
it("drops a superadministrator password reset event", async () => {});
it("does not drop unrelated administrator events", async () => {});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- server/googleWorkspace/collectors/alertCenter.test.ts`

Expected: FAIL because the collector and normalizer do not exist.

- [ ] **Step 3: Implement Alert Center listing**

Call:

```text
GET https://alertcenter.googleapis.com/v1beta1/alerts
```

Use `customerId`, `pageSize`, `pageToken`, `orderBy=createTime asc`, and a `createTime` filter starting five minutes before the last successful event time. On the first run, use a configurable 24-hour bootstrap lookback; historical backfill is a separate explicit operation.

- [ ] **Step 4: Normalize and filter**

Create stable event IDs from `alert_center` and Google `alertId`. Preserve the original alert type, source, create time and essential structured fields in metadata. Implement an explicit predicate named `isExcludedSuperadminPasswordReset`; keep its matching rules narrow and covered by tests.

- [ ] **Step 5: Run verification**

Run: `npm test -- server/googleWorkspace/collectors/alertCenter.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** Alert Center data is collected without mutation, normalized, deduplicable, and filtered according to the approved exclusion.

---

## Task 6: Collect Reports API evidence for login, admin, OAuth and Drive

**Files:**
- Create: `server/googleWorkspace/collectors/reports.ts`
- Create: `server/googleWorkspace/normalizers/reports.ts`
- Test: `server/googleWorkspace/collectors/reports.test.ts`

- [ ] **Step 1: Write fixtures and failing tests**

Cover these applications and representative activities:

```text
login       suspicious login, failed login, account disabled
admin       role/configuration changes, excluding only superadmin password reset
token       OAuth authorization and suspicious token activity
drive       external sharing, visibility and download-related activity when exposed
```

Tests must verify pagination, stable IDs, actor/IP extraction, severity mapping, five-minute overlap and source-specific cursor isolation.

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- server/googleWorkspace/collectors/reports.test.ts`

Expected: FAIL because the Reports collector and normalizer do not exist.

- [ ] **Step 3: Implement a constrained Reports collector**

Call only:

```text
GET https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications/{applicationName}
```

Allow only `login`, `admin`, `token`, and `drive` as application names. Set `customerId`, `startTime`, `endTime`, `maxResults`, and `pageToken`. Treat a Google `403` for a licensed-but-unavailable source as a source failure, not as an empty successful result.

- [ ] **Step 4: Normalize activity records**

An activity containing multiple events becomes one normalized event per child event. Build the external ID from application, activity unique qualifier, event name and stable child index. Keep the raw parameter map bounded: discard values larger than the configured metadata limit and record that truncation occurred.

- [ ] **Step 5: Apply the approved exclusion**

Reuse a shared narrow exclusion predicate for superadministrator password-reset activity. Confirm ordinary password changes, login attacks, role changes and recovery-setting changes remain visible.

- [ ] **Step 6: Run verification**

Run: `npm test -- server/googleWorkspace/collectors/reports.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** Four Reports sources can advance independently and retain complete audit evidence without false success on authorization errors.

---

## Task 7: Capture Directory security posture

**Files:**
- Create: `server/googleWorkspace/collectors/directory.ts`
- Create: `server/googleWorkspace/normalizers/directory.ts`
- Test: `server/googleWorkspace/collectors/directory.test.ts`

- [ ] **Step 1: Write failing posture tests**

Verify that the snapshot identifies:

```ts
it("counts active and suspended users", async () => {});
it("counts users without two-step verification enrollment", async () => {});
it("resolves delegated administrators from role assignments", async () => {});
it("paginates users and role assignments", async () => {});
it("does not store recovery emails, phone numbers or access credentials", async () => {});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npm test -- server/googleWorkspace/collectors/directory.test.ts`

Expected: FAIL because the Directory collector and normalizer do not exist.

- [ ] **Step 3: Implement read-only Directory calls**

Use only GET endpoints beneath:

```text
https://admin.googleapis.com/admin/directory/v1/users
https://admin.googleapis.com/admin/directory/v1/customer/{customerId}/roles
https://admin.googleapis.com/admin/directory/v1/customer/{customerId}/roleassignments
```

Request only fields required for identity, status, administrator role and 2SV posture. Do not request or persist recovery contact details.

- [ ] **Step 4: Persist a compact posture snapshot**

Store counts and minimal per-user posture records keyed by immutable Google user ID. Include `capturedAt`, domain and collection completeness. A partial Directory traversal must not replace the previous complete snapshot.

- [ ] **Step 5: Run verification**

Run: `npm test -- server/googleWorkspace/collectors/directory.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** Fluxora has a safe, minimal identity-security baseline without collecting unnecessary personal data.

---

## Task 8: Orchestrate independent sources, partial failures and retention cleanup

**Files:**
- Create: `server/googleWorkspace/retention.ts`
- Create: `server/googleWorkspace/sync.ts`
- Test: `server/googleWorkspace/retention.test.ts`
- Test: `server/googleWorkspace/sync.test.ts`

- [ ] **Step 1: Write failing orchestration tests**

Cover:

```ts
it("persists successful sources when another source fails", async () => {});
it("returns partial when at least one source succeeds and one fails", async () => {});
it("returns failure when every source fails", async () => {});
it("does not run two sync cycles concurrently", async () => {});
it("continues from each source's last successful cursor", async () => {});
it("removes at most 200 expired detailed events per cycle", async () => {});
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npm test -- server/googleWorkspace/retention.test.ts server/googleWorkspace/sync.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement source orchestration**

Expose:

```ts
export interface WorkspaceSyncSummary {
  status: "success" | "partial" | "failure" | "skipped_locked";
  startedAt: string;
  finishedAt: string;
  sources: Record<string, {
    status: "success" | "failure";
    collected: number;
    persisted: number;
    safeError?: string;
  }>;
  expiredEventsRemoved: number;
}
```

Run collectors independently with `Promise.allSettled`. Use a Firestore lease with a short expiration to avoid overlapping Vercel invocations. Release it in `finally`; an expired lease may be reclaimed.

- [ ] **Step 4: Implement bounded retention**

Query detailed events where `expiresAt <= now`, limit to 200, and delete exactly those document IDs. Cleanup failure must be reported in the summary but must not roll back already persisted source evidence.

- [ ] **Step 5: Add safe structured logging**

Log one start and one completion record with run ID, source name, counts, duration and safe status. Do not log event metadata, emails, IP addresses, Google response bodies or credential material in this phase.

- [ ] **Step 6: Run verification**

Run: `npm test -- server/googleWorkspace/retention.test.ts server/googleWorkspace/sync.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

**Checkpoint:** A source outage cannot block healthy sources, corrupt cursors, overlap a cycle, or bypass retention.

---

## Task 9: Expose secure internal sync and application status

**Files:**
- Create: `server/internalAuth.ts`
- Test: `server/internalAuth.test.ts`
- Modify: `api/index.ts`
- Modify: `server/routers.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Extract and test internal-route authorization**

Move the existing scheduled-sync authorization into `server/internalAuth.ts`. Verify constant-time comparison, acceptance of `Authorization: Bearer <CRON_SECRET>`, rejection of missing or malformed credentials, and no secret echo in errors.

Run: `npm test -- server/internalAuth.test.ts`

Expected before implementation: FAIL.

- [ ] **Step 2: Add the internal Workspace endpoint**

In `api/index.ts`, add:

```text
GET /api/internal/sync-google-workspace
```

Requirements:

- authenticate with the shared internal authorization helper;
- return `503` with a safe `configuration_missing` code when Workspace variables are absent;
- call `syncGoogleWorkspaceSecurity()` once;
- return `200` for `success`, `partial`, or `skipped_locked` and `500` for total failure;
- return only counts, timestamps, source status and safe error categories.

- [ ] **Step 3: Add protected tRPC status procedures**

In `server/routers.ts`, add a `workspaceSecurity` router with:

```ts
status: protectedProcedure.query(...)
syncNow: adminProcedure.mutation(...)
```

`status` reads persisted state only. `syncNow` starts the same bounded cycle and returns its summary; it performs no Google or Workspace mutations.

- [ ] **Step 4: Configure the 15-minute cron**

After confirming the production Vercel project is Pro or Enterprise, add:

```json
{
  "path": "/api/internal/sync-google-workspace",
  "schedule": "*/15 * * * *"
}
```

Keep the existing n8n synchronization schedule unchanged. Ensure `CRON_SECRET` is configured in Production.

- [ ] **Step 5: Add a status-only health field**

Extend the existing health response with a non-sensitive summary:

```json
{
  "googleWorkspaceSecurity": {
    "configured": true,
    "lastStatus": "success",
    "lastSuccessAt": "ISO-8601 timestamp"
  }
}
```

Do not include customer IDs, domain, administrator email, scopes or errors in the public health payload.

- [ ] **Step 6: Run verification**

Run: `npm test -- server/internalAuth.test.ts server/googleWorkspace`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS and a production bundle in `dist/`.

**Checkpoint:** Vercel can invoke one authenticated, bounded, read-only Workspace cycle every 15 minutes, while users can see safe status inside the application.

---

## Task 10: Document setup, deploy safely and verify the complete collection flow

**Files:**
- Modify: `README-VERCEL.md`
- Modify: `README.md`

- [ ] **Step 1: Document Google Cloud and Admin Console setup**

Add exact operator steps:

1. Create or select a dedicated Google Cloud project.
2. Enable Alert Center API, Admin SDK API and Reports API.
3. Create a dedicated service account and enable domain-wide delegation.
4. Create a restricted delegated audit administrator in Google Workspace.
5. Authorize only the scopes listed in Task 1.
6. Note prominently that Alert Center has no read-only OAuth scope; Fluxora compensates with GET-only code and a restricted administrator.
7. Add the five required variables to Vercel Production and Preview as appropriate.
8. Confirm `CRON_SECRET` is at least 16 random characters.
9. Confirm the Vercel production project is Pro or Enterprise before deploying the 15-minute cron.

- [ ] **Step 2: Document smoke-test expectations**

The runbook must define these checks without exposing data:

```text
1. /api/health reports configured=true.
2. An unauthenticated internal sync call returns 401.
3. An authenticated sync returns success or partial with source counts.
4. A second identical cycle creates no duplicate event documents.
5. Per-source lastSuccessAt advances only for successful sources.
6. A forced source authorization error produces partial, not a blank success.
7. No superadmin password-reset event is present.
8. Every stored detailed event has expiresAt 183 days after occurredAt.
```

- [ ] **Step 3: Run the complete local verification suite**

Run: `npm test`

Expected: all tests PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Perform a production-safe deployment verification**

After the owner confirms environment variables and Vercel plan:

1. Deploy to a preview environment with a test Workspace tenant or a narrowly restricted production audit account.
2. Call the internal route once with valid authorization.
3. Inspect Vercel runtime logs for the run ID and source counts only.
4. Inspect Firestore counts and sync-state documents.
5. Run the same call again and confirm stable event counts except for genuinely new Workspace activity.
6. Promote to production only after all smoke checks pass.

- [ ] **Step 5: Record the handoff boundary**

State that this plan delivers collection, retention and status only. The next plan begins incident correlation, risk scoring, dashboards, notifications and the approved consultative investigation workflow.

**Checkpoint:** The foundation is documented, tested end to end, deployed only with valid prerequisites, and ready for the incident-detection phase.

---

## Final Verification Gate

- [ ] Every Google data call is GET-only and host-restricted.
- [ ] The broad Alert Center scope has compensating controls and tests.
- [ ] Superadministrator password-reset events are excluded narrowly.
- [ ] Login, admin, OAuth token, Drive and Alert Center sources have isolated cursors.
- [ ] Partial failures retain healthy-source progress and surface failed sources.
- [ ] Event writes are idempotent and cursor advancement is atomic with persistence.
- [ ] Detailed events carry a 183-day expiry and cleanup is bounded.
- [ ] No credential or personal event payload appears in logs or health responses.
- [ ] The 15-minute schedule is deployed only on Vercel Pro or Enterprise.
- [ ] `npm test`, `npm run check`, and `npm run build` pass.
- [ ] Run a final search for unresolved planning markers and confirm that none remain.
