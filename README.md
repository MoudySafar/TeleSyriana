# TeleSyriana Support OS (MVP - Team Runnable)

This version is upgraded to a **team-runnable MVP** on pure HTML/CSS/JS with persistent local storage.

## What is now improved
- Persistent data using browser storage (staff, tickets, chat, time tracking).
- Admin/Manager staff creation form (no public registration flow).
- Role-aware visibility for tickets and manager tools.
- Break/late/pay estimate summary per user.
- Ticket status update tool (Open, Waiting, Escalated, Resolved, Closed).
- TeleSyriana-style dark blue/cyan theme and bilingual UI (Arabic/English) + RTL direction.
- Bilingual UI (Arabic/English) + RTL direction.

## Important
This is still an MVP front-end package. For full production operation you should next connect:
- Firebase Authentication or Cloud Functions for secure staff-code auth
- Firestore for shared realtime multi-user data
- Firebase Storage for chat attachments and profile assets
- Security rules for strict role-based enforcement

## Run
Open `index.html` in browser.

## Demo users
- Agent: `0001 / 2411`
- Supervisor: `1001 / 5566`
- Manager: `2001 / 7788`
- Admin: `9999 / 0000`

## Next steps
- Connect Firebase Authentication / Firestore persistence
- Add Shopify order autofill API
- Add reports (morning/midday/end-shift) persistence/export
- Add SLA timers and advanced performance analytics
