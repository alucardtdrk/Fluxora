# Google Workspace Audit Visibility Design

## Goal

Make the Workspace Security panel useful for daily audit work by exposing the result of each Google source and expanding the security-relevant Reports API coverage.

## Scope

- Remove the completed Firestore migration control from Settings and its administrative mutation.
- Retain the existing organized Firestore data model; do not delete, migrate, or alter unrelated data.
- Persist safe synchronization diagnostics per source: status, collected count, persisted count, time and a closed safe error code.
- Display those diagnostics in Workspace Security so an empty source can be distinguished from a failed source.
- Add Reports API sources for group administration, mobile-device activity and rules activity, using the existing audit-readonly authorization.
- Keep the existing sources: Alert Center, login, admin, OAuth token, Drive and directory posture.

## Data Flow

Each source run returns its normal event counts plus a safe status. The synchronization coordinator persists this state with the source checkpoint. The dashboard reads current source status alongside events and posture, then renders a compact source-health section. Detailed upstream responses, tokens, email content and raw audit parameters remain excluded.

The new Reports sources use the same collector, normalizer, retention rules and event identity strategy already used for login, admin, token and Drive. They are independent: one failure produces a visible source failure without preventing other sources from completing.

## User Experience

The Settings security tab keeps only the Workspace sync action; the Firestore organization card is removed.

The Workspace Security page adds a "Fontes de auditoria" section showing each source's state:

- collected and persisted counts;
- last successful or failed attempt;
- one of `ok`, `empty`, `permission`, `configuration` or `unknown`;
- a concise action hint when administrative authorization is required.

An empty source is expected when there are no events in its collection window. A permission or configuration state makes the required corrective action visible instead of silently leaving the dashboard with one event.

## Safety Constraints

- Read-only Google Workspace access only.
- Persist only allowlisted, normalized security metadata.
- Do not expose service-account credentials, raw API errors, token data or document contents in the UI or audit log.
- Do not touch Firestore collections outside the Fluxora data paths already in use.
- Preserve existing events and checkpoints.

## Verification

- Unit-test source status normalization and persistence for success, empty result and denied upstream access.
- Unit-test each added report application normalization.
- Verify a source failure does not block other sources.
- Run focused Workspace tests, complete test suite, type check and production build.
