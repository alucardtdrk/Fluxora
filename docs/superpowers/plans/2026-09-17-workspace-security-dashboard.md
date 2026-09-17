# Workspace Security Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an operational read-only Google Workspace Security dashboard that exposes synchronized evidence already stored in Firestore.

**Architecture:** A focused server module reads and maps Workspace event and posture documents into a display-safe overview. A protected tRPC query exposes that overview to a new client route. The page renders summary cards and a filtered event list without querying Google APIs.

**Tech Stack:** TypeScript, tRPC, React, Wouter, Firestore REST helper, Vitest, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-09-17-workspace-security-dashboard-design.md`

## Global Constraints

- Read only `fluxora_workspace_security_events` and `fluxora_workspace_directory_posture/current`.
- Limit the Firestore event query to 250 documents ordered by `occurredAt` descending.
- Return no event metadata payloads or credentials through tRPC.
- The dashboard is available to authenticated users; manual synchronization remains admin-only.
- Use no new dependencies.

---

### Task 1: Workspace dashboard data module

**Files:**
- Create: `server/googleWorkspace/dashboard.ts`
- Create: `server/googleWorkspace/dashboard.test.ts`

**Interfaces:**
- Produces `getWorkspaceSecurityDashboard(): Promise<WorkspaceSecurityDashboard>`.
- Produces `WorkspaceSecurityDashboard` with `events`, `summary`, and nullable `posture`.
- Consumes `runFirestoreQuery`, `getFirestoreDocument`, and repository collection constants.

- [ ] **Step 1: Write the failing test**

```ts
it("maps safe event fields and derives dashboard totals", async () => {
  const dashboard = await createWorkspaceSecurityDashboard({
    listEvents: async () => [event({ severity: "high" }), event({ severity: "low" })],
    getPosture: async () => ({ users: { suspended: 2, withoutTwoStepVerification: 5 } }),
  }).load();
  expect(dashboard.summary).toEqual({ recentEvents: 2, highOrCriticalEvents: 1 });
  expect(dashboard.posture).toEqual({ suspendedUsers: 2, usersWithoutTwoStepVerification: 5 });
  expect(dashboard.events[0]).not.toHaveProperty("metadata");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Expected: FAIL because `createWorkspaceSecurityDashboard` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export function createWorkspaceSecurityDashboard(dependencies: DashboardDependencies) {
  return { async load(): Promise<WorkspaceSecurityDashboard> {
    const [events, posture] = await Promise.all([dependencies.listEvents(), dependencies.getPosture()]);
    const safeEvents = events.map(toDashboardEvent);
    return {
      events: safeEvents,
      summary: {
        recentEvents: safeEvents.length,
        highOrCriticalEvents: safeEvents.filter((event) => event.severity === "high" || event.severity === "critical").length,
      },
      posture: posture ? toDashboardPosture(posture) : null,
    };
  }};
}
```

- [ ] **Step 4: Add Firestore-backed export**

```ts
export async function getWorkspaceSecurityDashboard() {
  if (!isFirestoreConfigured()) return emptyDashboard();
  return createWorkspaceSecurityDashboard({ listEvents, getPosture }).load();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Expected: PASS.

### Task 2: Protected tRPC endpoint

**Files:**
- Modify: `server/routers.ts`

**Interfaces:**
- Consumes `getWorkspaceSecurityDashboard()` from Task 1.
- Produces `workspaceSecurity.overview` as a protected tRPC query.

- [ ] **Step 1: Write the failing type-level use site**

```ts
workspaceSecurity: router({
  overview: protectedProcedure.query(() => getWorkspaceSecurityDashboard()),
}),
```

- [ ] **Step 2: Run typecheck to verify the missing import fails**

Run: `npm run check`

Expected: FAIL until Task 1 exports the function.

- [ ] **Step 3: Add the import and router block**

```ts
import { getWorkspaceSecurityDashboard } from "./googleWorkspace/dashboard.js";
// inside appRouter
workspaceSecurity: router({
  overview: protectedProcedure.query(() => getWorkspaceSecurityDashboard()),
}),
```

- [ ] **Step 4: Run typecheck**

Run: `npm run check`

Expected: PASS.

### Task 3: Operational dashboard page and navigation

**Files:**
- Create: `client/src/pages/WorkspaceSecurity.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/OperationsShell.tsx`

**Interfaces:**
- Consumes `trpc.workspaceSecurity.overview.useQuery()` from Task 2.
- Produces `/workspace-security` and the “Workspace Security” operation navigation item.

- [ ] **Step 1: Write the failing route import**

```tsx
import WorkspaceSecurity from "./pages/WorkspaceSecurity";
<Route path="/workspace-security" component={WorkspaceSecurity} />
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `npm run check`

Expected: FAIL because the page module does not exist.

- [ ] **Step 3: Implement the page**

```tsx
const dashboard = trpc.workspaceSecurity.overview.useQuery(undefined, { retry: false });
const [source, setSource] = useState("all");
const [severity, setSeverity] = useState("all");
const events = (dashboard.data?.events ?? []).filter((event) =>
  (source === "all" || event.source === source) &&
  (severity === "all" || event.severity === severity),
);
```

Render four cards from `dashboard.data.summary` and `dashboard.data.posture`, then a table with event date, source, severity, title, and actor. Render explicit loading, query-error, and empty states.

- [ ] **Step 4: Add navigation item**

```ts
{ label: "Workspace Security", path: "/workspace-security", icon: ShieldCheck },
```

Add it to `operationItems` after Analytics so it is visible to every authenticated user and appears in mobile navigation and command search automatically.

- [ ] **Step 5: Run typecheck**

Run: `npm run check`

Expected: PASS.

### Task 4: End-to-end verification and handoff

**Files:**
- Modify: files from Tasks 1-3 only if verification finds a defect.

- [ ] **Step 1: Run focused dashboard tests**

Run: `npm test -- --run server/googleWorkspace/dashboard.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full tests**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 3: Run typecheck and production build**

Run: `npm run check`

Expected: PASS.

Run: `npm run build`

Expected: successful production output.

- [ ] **Step 4: Review scope**

Run: `git diff --check` and `git status --short`.

Expected: only the dashboard module, its test, route, navigation, page, and the design/plan files are changed.
