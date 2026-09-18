# Google Workspace Security Depth Design

## Goal

Turn Workspace Security into a useful 90-day audit and posture view while keeping Vercel Hobby Fluid Active CPU usage bounded and preserving read-only Google access.

## Platform Constraints

- Keep the existing single daily Google Workspace cron. Vercel Hobby does not guarantee the exact minute and permits daily schedules.
- Keep each invocation independently resumable and comfortably below the configured 300-second maximum.
- Optimize for Fluid Active CPU: bound pages, events, correlations and Firestore work; do not rescan or reclassify the full history on each run.
- Add no paid service, queue, worker or production dependency.
- Keep Google access read-only and do not store message bodies, document contents, credentials, raw tokens or raw upstream errors.

## Collection Architecture

The regular incremental sync remains the primary daily path. Each source reads forward from its last successful event with the existing overlap and persists deterministic event IDs.

A separate resumable backfill state is stored per source. It covers the previous 90 days in 24-hour windows. A sync invocation may advance at most one backfill window for each eligible source and must stop when a shared execution budget is reached. Completed windows are never recomputed unless an administrator explicitly resets the backfill in a future feature.

The execution budget uses deterministic limits rather than CPU sampling:

- maximum pages per source run;
- maximum normalized events per source run;
- maximum backfill windows per invocation;
- a wall-clock deadline used only as a final safety guard.

When a budget is reached, the source returns a safe `partial` result and persists its continuation state. Repeating a partially completed request remains safe because event IDs are deterministic and Firestore writes are idempotent.

## Sources

Retain Alert Center, Login, Admin, OAuth token, Drive, Groups, Mobile, Rules and Directory posture.

Add Reports API sources in this priority order:

1. Gmail;
2. User accounts and SAML identity activity where the Reports API exposes them;
3. Calendar;
4. Chat;
5. Meet.

Each source is independent. Unsupported editions, missing privileges, empty windows and upstream failures must not prevent other sources from completing. The UI uses closed safe reason codes such as `permission`, `unsupported`, `configuration`, `rate_limit` and `unknown`; it never exposes raw Google responses.

## Source State and Coverage

Each source state records:

- last attempted and successful collection times;
- requested range start and end;
- collected and persisted counts;
- latest event time;
- backfill target, covered-through time and completion percentage;
- continuation token when a page budget interrupts a window;
- status and safe reason code;
- freshness lag derived from the latest successful collection.

The dashboard distinguishes `healthy`, `empty`, `partial`, `unsupported`, `permission`, `configuration` and `failure`. An empty successful response is not presented as a failure.

## Classification and Findings

Normalization remains allowlist-based. Severity rules become source-specific and use Google parameters when supplied:

- critical or high: account compromise indicators, leaked credentials and severe DLP/rule matches;
- high: 2SV disabled, sensitive privilege changes, suspicious OAuth grants, external/public Drive exposure and high-severity rule triggers;
- medium: login failures, less-sensitive administrative changes and policy changes;
- low or informational: routine successful activity that is useful for audit but not inherently risky.

Correlation processes only the newly affected time range plus the largest required look-behind window. It must not reread and correlate the complete 90-day history after every sync. Existing correlation rules remain and gain rules for 2SV disablement, privilege escalation, risky OAuth grants, external/public sharing and high-severity DLP activity.

Findings use deterministic IDs and upsert semantics. Resolved-state workflow is outside this change; the panel reports currently derived findings from retained evidence.

## Directory Posture

The directory snapshot retains aggregate counts and adds safe per-user posture records for accounts without 2SV and suspended accounts. Records contain only identifiers needed for remediation, such as user ID, primary email, display name when available, organizational unit, suspension and 2SV state. The collector requests only these allowlisted fields.

The dashboard shows actionable lists, counts and changes since the previous snapshot. It does not infer that suspended accounts are security incidents; they remain a posture category.

## Dashboard Experience

Workspace Security adds:

- a coverage summary for the 90-day target;
- backfill progress and a manual `Continuar histórico` action for administrators;
- source cards showing consulted period, freshness, collected, persisted and status;
- clear guidance for unsupported editions, missing privileges and configuration errors;
- filters for date range, source, severity and category;
- actionable posture sections for users without 2SV and suspended accounts;
- expanded finding cards with evidence timeline and safe event detail.

The dashboard endpoint returns bounded pages rather than the current fixed undifferentiated event list. Summary counts are computed from bounded aggregate queries or stored source summaries, not by loading all retained events into the function.

## Operational Flow

The daily cron performs incremental collection first, advances bounded backfill second, updates affected findings third and refreshes posture last when the remaining execution budget permits. A skipped stage remains visible and resumes on the next invocation.

The manual sync uses the same coordinator and limits. Concurrent invocations use a Firestore lease with expiry rather than an in-memory lock, because Vercel may run separate function instances.

The existing cron secret validation remains required. No deploy or environment mutation is part of this implementation.

## Error Handling

- HTTP 401/403 becomes `permission` unless a source is known to be edition-restricted, in which case it becomes `unsupported` when Google provides a recognizable safe signal.
- HTTP 429 becomes `rate_limit` and preserves continuation state.
- Time or page budget exhaustion becomes `partial`, not `failure`.
- Persistence failure never advances a checkpoint.
- A failed source or correlation stage does not discard successful source results.

## Testing

- Unit tests cover window planning, continuation, budgets, idempotency and safe status mapping.
- Collector tests cover every new application and page/event budget behavior.
- Normalizer tests cover the new source mappings and security severity rules.
- Repository tests cover backfill checkpoints, leases and posture detail persistence.
- Runtime tests prove partial progress resumes and one source failure does not block others.
- Dashboard tests cover coverage metrics, pagination, source guidance and posture lists.
- UI tests cover filtering, progress and administrator-only manual continuation.
- Final verification runs focused Workspace tests, type checking and the production build.

## Delivery Sequence

1. Add bounded collection primitives and persisted backfill state.
2. Add sources and source-specific classification.
3. Make correlation incremental and add high-value findings.
4. Persist actionable directory posture.
5. Expose coverage, pagination and operational diagnostics through the API.
6. Update the Workspace Security interface.
7. Verify CPU-bounded behavior, tests, types and build.

## Non-Goals

- No automatic remediation or Google Workspace writes.
- No email or document-content storage.
- No external queue, paid Vercel feature or new database.
- No deployment, environment-variable change or Workspace privilege change.
- No redesign of unrelated Fluxora pages.
