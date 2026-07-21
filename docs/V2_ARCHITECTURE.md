# TeleSyriana V2 Architecture

## Purpose
TeleSyriana V2 is a multi-project internal operations platform. The first migration target is the existing iPro operation, which remains the default project and must continue to work while new capabilities are introduced in isolated, testable stages.

## Safety rules
1. `main` is treated as protected/current baseline during V2 development.
2. New V2 work is developed on `development/v2` and smaller feature branches where useful.
3. Existing iPro ticket and Shopify behaviour must be verified before legacy paths are removed.
4. Existing historical business data is migrated, not discarded.
5. UI hiding is never considered sufficient authorization; project and role restrictions must be enforced at the data/API layer.

## Identity model
A person has one TeleSyriana user account. Work access is represented through project memberships.

### User
Stores identity/account-level information such as:
- id
- employee/staff code
- display name
- login identity
- account status (`active`, `disabled`)
- language preference
- theme preference
- created/updated timestamps

### Project
Represents a business/workspace, for example:
- iPro (default)
- future Shopify/business projects

### Project membership
Stores project-specific work authorization:
- user_id
- project_id
- role
- team_id (optional)
- supervisor_id (optional)
- membership status
- created/updated timestamps

Roles must not be reduced to one global `user.role` because the same employee may have different responsibilities in different projects.

## Visibility model
### CEO
- Global visibility of all projects.
- May enter/switch projects.
- Global administrative/reporting access subject to explicit permissions.

### HR
- Global project visibility for employee/recruitment responsibilities.
- May manage employee accounts, project memberships, jobs and HR workflows.
- Ticket/customer-content access can remain independently permission-controlled.

### Manager
- Access only to projects explicitly assigned through membership/permission.
- Must not browse unrelated projects.

### Supervisor
- Fully contained inside the assigned project context.
- May manage assigned team according to permissions.
- Must not see names, navigation, searches, API data or integrations belonging to unrelated projects.

### Agent
- Fully contained inside the assigned project context.
- Must not discover unrelated projects.

## Example
Reema Obaid:
- iPro -> Supervisor
- another project -> no membership (therefore completely invisible)

A promotion from Agent to Supervisor in iPro changes only the iPro membership.

## Permission model
Use capabilities instead of scattering role-name checks throughout the application.

Suggested capabilities:
- `projects.view_all`
- `projects.manage`
- `employees.view`
- `employees.create`
- `employees.disable`
- `employees.reactivate`
- `employees.change_role`
- `employees.assign_project`
- `employees.assign_team`
- `tickets.view_own`
- `tickets.view_team`
- `tickets.view_project`
- `tickets.search`
- `tickets.assign`
- `tickets.resolve`
- `jobs.create`
- `jobs.manage`
- `jobs.apply`
- `jobs.refer`
- `integrations.manage`
- `audit.view`

The backend/data layer must resolve permissions from authenticated user + project membership before returning project data.

## Core data domains
The shared/cloud authoritative model should include at minimum:
- users
- projects
- project_memberships
- teams
- team_members
- tickets
- ticket_comments
- ticket_history
- chat_channels
- chat_channel_members
- chat_messages
- chat_reactions
- chat_read_states
- jobs
- job_applications
- job_referrals
- shopify_integrations
- audit_logs

Existing payroll/attendance data should be migrated into dedicated shared records as part of the wider migration rather than remaining authoritative in browser local storage.

## iPro migration contract
- Create/identify iPro as the default project.
- Existing employees are given iPro memberships matching their intended iPro responsibility.
- Existing tickets are assigned `project_id = iPro` while preserving ticket IDs and history.
- Existing iPro Shopify behaviour remains the default integration path until a project-aware replacement passes equivalence tests.
- Existing records must retain ownership references when an employee is disabled.

## Employee lifecycle
Normal removal from work is a soft/account-state action:
- Active -> Disabled
- Disabled users cannot log in.
- Historical tickets, comments, messages, payroll, applications and audit records remain intact.

Removing an employee from one project is separate from disabling the whole TeleSyriana account.

## Shopify integrations
Shopify connections belong to projects. Credentials/secrets are server-side only.

Each connection should include:
- project_id
- provider (`shopify`)
- store identity/domain
- encrypted/secret credential reference
- connection status
- default flag where needed
- created/updated/audited metadata

The existing iPro Shopify connection is preserved first and represented as the default iPro integration before additional projects are connected.

## Tickets V2
Ticket search must query the shared ticket store rather than only the currently rendered list.

Minimum search fields:
- ticket ID
- order number
- customer name
- customer email
- tracking number
- assigned employee

Minimum ticket fields:
- ticket id
- project id
- order/customer references
- type
- priority
- status
- created by
- assigned user/team
- created at
- updated at
- resolved at
- last activity

Views should include My Tickets, Team Tickets, Open, Waiting, Escalated, Resolved and All, plus Today/Yesterday/Last 7/Last 30/Custom activity filters. `Today` is activity-based (`updated_at`) so an old ticket updated today appears there.

## Realtime/update model
Normal operation should not depend on repeated manual refresh buttons.

Desired behaviour:
1. Client reads cached/current state.
2. Shared backend/database is authoritative.
3. Changes propagate to relevant connected clients via realtime subscriptions or controlled revalidation.
4. UI exposes connection/loading/retry states.
5. Manual refresh remains a fallback, not the standard synchronization mechanism.

## Chat V2
Authoritative chat state is cloud/shared.

Required features:
- project/company channels according to permissions
- multiline composer (`Enter` send, `Shift+Enter` newline)
- reactions
- edit state
- soft delete
- unread counters
- cloud read state

Channel read state can store last-read message/time per user/channel rather than duplicating a read row for every historical message.

## Jobs
A Jobs module supports:
- HR/authorized Manager job posting
- project association
- internal employee applications
- employee referrals
- application states such as New, Review, Interview, Offer, Hired, Rejected, Withdrawn

Employees only see opportunities they are allowed to view; project isolation continues to apply.

## Internationalization and themes
All UI strings should come from one i18n source rather than duplicated hardcoded English/Arabic fragments.

Arabic must receive complete RTL QA for navigation, tables, forms, tickets, chat, jobs, menus and modals.

Theme modes:
- Light
- Dark
- System

Theme and language preferences may be cached locally for fast startup, but the employee profile should be the portable preference source.

## Audit requirements
Sensitive actions must generate audit records, including:
- employee creation/disable/reactivation
- role/team/project changes
- Shopify integration changes
- ticket assignment/status/priority changes
- privileged message deletion when applicable
- Jobs management actions

## Test gates
A feature is not considered complete until its role/project isolation tests pass. Critical cases include:
- Supervisor/Agent cannot discover another project through UI, direct URL, search or API manipulation.
- Reema's iPro promotion does not grant another-project access.
- Disabled users cannot authenticate but historical ownership remains intact.
- iPro Shopify lookup produces expected results before legacy behaviour is removed.
- Ticket search returns permitted historical/resolved results from the shared store.
- Chat read/unread state persists across sessions/devices.
