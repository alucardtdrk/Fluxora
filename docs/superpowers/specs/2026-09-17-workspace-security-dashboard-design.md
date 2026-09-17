# Workspace Security Dashboard

## Goal

Expose the Google Workspace security evidence already synchronized into Firestore in an operational, read-only view.

## Route and access

- Add `/workspace-security` under the **Operação** navigation group.
- Any authenticated Fluxora user may view the dashboard.
- Only administrators retain the existing ability to trigger a manual synchronization from Settings.

## Server data contract

- Add a protected `workspaceSecurity.overview` query.
- Read at most 250 documents from `fluxora_workspace_security_events`, ordered by `occurredAt` descending.
- Read the current document from `fluxora_workspace_directory_posture`.
- Return only display-safe event fields: id, source, category, type, severity, title, description, occurredAt, actor, target, ipAddress, and country.
- Compute summary counts from the returned events: total recent events and high-or-critical events.
- Return directory posture values when available: suspended users and users without two-step verification.

## Screen

- Four summary cards: recent events, high/critical events, users without 2SV, and suspended users.
- Client-side filters for source and severity.
- A recent-events table with date, source, severity, event, and actor.
- Loading, empty, and query-error states.
- No event metadata payload is shown in the initial interface.

## Error handling and verification

- A missing Firestore configuration returns an empty dashboard payload rather than leaking configuration details.
- Firestore failures surface as a generic query error to authenticated users.
- Unit tests cover safe mapping, count calculation, filter behavior, and the empty posture case.
- Typecheck, full test suite, and production build validate the change.
