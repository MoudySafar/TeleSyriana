# TeleSyriana V2 implementation checkpoint

## Safety

- Development remains isolated on `development/v2`.
- `main` has not been converted to V2.
- PR #5 remains draft.
- Existing iPro Shopify remains the protected legacy/default connection during migration.

## Implemented backend foundations

- PostgreSQL users/projects/project memberships/teams/audit foundation
- centralized project/role capability engine
- CEO/HR global project visibility
- Manager project-scoped access
- Supervisor/Agent project isolation
- hashed authentication + server sessions + lockout + secret reset
- employee create/promote/project disable/reactivate/global disable/reactivate
- cross-project employee membership without overwriting another project role
- Supervisor-scoped team management
- project creation and timezone management
- encrypted project Shopify connection records + verify/activate workflow
- protected iPro legacy Shopify connection
- project-scoped Shopify order search
- Tickets V2 schema, search, comments, history and optimistic versioning
- Agent own queue / Supervisor team queue / Manager project queue
- Active/Resolved/All ticket filters
- Today/Yesterday/Last 7/Last 30 filters based on `updated_at` in project timezone
- ticket comment changes count as ticket activity
- Chat V2 cloud messages/reactions/edit/soft-delete/read state/team channels
- Jobs postings/applications/referrals/pipeline
- employee directory with Supervisor/Manager/HR visibility boundaries
- cloud EN/AR + Light/Dark/System preference persistence
- workspace capability context for frontend navigation
- CEO/HR audit log reader
- PostgreSQL LISTEN/NOTIFY project event foundation
- capability-filtered Server-Sent Events

## Implemented frontend staging shell

- employee sign-in
- capability-driven navigation
- project selector shown only for CEO/HR global project viewers
- Dashboard
- Tickets split view, queue/search/status/date filters, detail, status/comments
- Shopify order search
- Chat channels, multiline composer, reactions, delete, cloud read state
- Jobs create/apply/refer/pipeline view
- Employees list/create/role change
- Teams list/create/members
- Shopify Integrations list/add/verify/activate
- CEO Projects list/create
- English/Arabic translation foundation with RTL
- Light/Dark/System responsive theme
- realtime browser EventSource client for Ticket/Chat/Jobs refresh

## Realtime behavior now implemented in staging code

- PostgreSQL triggers emit project-scoped Ticket/Chat/Jobs changes.
- SSE endpoint is authenticated and project-scoped.
- HR cannot receive Ticket/Chat event IDs without those capabilities.
- Browser EventSource reconnects and re-renders the active Tickets/Chat/Jobs page instead of requiring manual refresh.
- Ticket comment changes bump the parent ticket `updated_at` and version, so Today reflects actual work activity.

## Not yet production-ready

- Automated V2 tests are written but a trustworthy completed GitHub CI run has not yet been observed.
- Staging database/runtime has not been provisioned through this connector.
- Existing real TeleSyriana production data has not been migrated.
- Existing iPro Shopify equivalence has not been exercised against live credentials here.
- Frontend employee account disable/reactivate and cross-project assignment controls still need completion.
- Team member add/remove UI should use employee selectors instead of raw IDs.
- Chat message edit UI still needs exposing (backend exists).
- Jobs pipeline status-change controls still need exposing (backend exists).
- Audit Log UI still needs exposing.
- Realtime migrations/listener need staging execution verification.
- Transitional V2 entrypoint files should be cleaned up only after the candidate staging entrypoint is validated.

## Current staging candidate

`v2/src/http/serve-staging.js`

Do not use it as production until the acceptance checklist in `v2/DEPLOYMENT.md` passes.
