# TeleSyriana V2 checkpoint — 21 July 2026

This checkpoint records the current branch state without changing `main`.

## Implemented

- centralized capabilities and project isolation
- CEO/HR global project visibility
- Manager project scope
- Supervisor/Agent isolation
- secure employee authentication/session foundation
- employee create/promote/disable/reactivate
- cross-project memberships that preserve each project role independently
- Supervisor-scoped teams and private team chat channels
- CEO project creation and timezone management
- protected legacy iPro Shopify connection
- encrypted project Shopify connection workflow
- project-scoped Shopify order search
- Tickets V2 search/queue/comments/history/versioning
- Agent own / Supervisor team / Manager project ticket queues
- Active/Resolved/All and Today/Yesterday/7/30-day activity filters
- ticket comments treated as ticket activity
- cloud Chat V2 with multiline/reactions/edit/soft-delete/read state
- Jobs postings/applications/referrals/pipeline
- scoped employee directory
- cloud language/theme preferences
- workspace capability endpoint for UI
- CEO/HR audit-log read service
- PostgreSQL project realtime notifications
- capability-filtered SSE
- responsive EN/AR + RTL + Light/Dark/System staging UI
- browser EventSource auto-refresh for active Tickets/Chat/Jobs page

## Current staging server

`v2/src/http/serve-staging.js`

## Still required before production

- execute and pass V2 test suite in a trustworthy CI/staging runtime
- execute all PostgreSQL migrations in staging
- verify real iPro Shopify equivalence
- migrate/verify real TeleSyriana ticket data
- finish remaining management UI controls
- expose Chat edit and Jobs pipeline transitions in UI
- expose Audit Log UI
- multi-client realtime test
- manual EN/AR and Light/Dark/System QA
- remove transitional duplicate V2 entrypoint files after candidate validation
- perform controlled role-by-role rollout and rollback test

PR #5 must remain draft until these gates pass. The existence of staging code is not evidence that production is ready.
