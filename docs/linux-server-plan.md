# Blew Chats — Linux-first personal server plan

Status: proposed implementation plan, 29 September 2026. This is the active direction; macOS/Electron work is deferred.

## Goal

Install Blew on a Linux computer and use it as an always-on personal AI server. Keep the existing WhatsApp-inspired web interface. Bots use the Linux computer's tools and applications within granted permissions, while important actions require an Allow / Decline decision. A future mobile app connects to the same server API.

## Deployment architecture

- Docker Compose: existing web server, Go API, PostgreSQL, semantic memory and speech services.
- Native Linux agent: runs outside Docker as the user's systemd service, with access to the user's allowed folders and desktop session. It uses an authenticated outbound connection to Blew; no public agent port is required.
- Clients: existing web interface first; mobile client later through authenticated HTTPS and WebSocket endpoints.
- PostgreSQL: private Docker network and persistent volume. Clients and native agents use the API, never direct database connections. Remove development database/API port exposure from production defaults; expose only the web gateway.
- No privileged containers, host-root mounts or Docker socket access to obtain desktop control.
- Desktop mode requires a logged-in graphical session. Headless mode supports terminal/files; desktop tools report unavailable until a supported desktop session is present. Computer uptime and connectivity govern remote availability.

## Milestone 1 — Reliable Linux installation and database operations

Package a production installation/start/update workflow around Compose. Generate unique database and internal-service credentials; separate development configuration from production. Persist database, account engine data, model cache and memory data outside disposable containers.

Manage PostgreSQL as a private service. Add scheduled backups with configurable retention and an owner-chosen destination; protect backups because they contain conversations and files. Export account engine secrets separately with encryption or require engine reconnection on restore. Verify restore into a separate database before claiming a backup is usable. Take a backup before schema upgrades and retain the previous release; do not blindly downgrade schema or erase volumes. Plan PostgreSQL major upgrades explicitly through dump/restore or a tested pg_upgrade workflow, never just change the image tag.

Acceptance: fresh install, reboot, service recovery, update, backup and restore preserve users, bots, messages, files, memories and schedules. Existing development data is backed up and migrated explicitly.

## Milestone 2 — Native Linux agent

Evolve the existing Linux companion into an installable user service. Connect it to an authenticated Blew account during setup and keep remote-machine pairing available. Store its token in a private configuration directory; revocation/sign-out/account switching stop old authorization.

Add capability discovery: OS, desktop session, available applications, permitted folders and installed automation tools. Report missing capabilities honestly. Start desktop support with a documented X11 session; use supported portals/compositor integrations for Wayland and test each supported environment before claiming parity. Do not promise arbitrary Wayland mouse/keyboard access.

Offer access setup for folders, app control, screen observation, microphone and notifications. No camera request. Run as an ordinary OS user; administrative changes require a separate explicit decision and supported elevation flow rather than collecting a sudo password in chat.

Acceptance: agent starts on login/reboot as appropriate, reconnects, reports capabilities, remains account-scoped, and stops tasks after disconnect/revocation. Desktop control never silently targets another user's session.

## Milestone 3 — Typed tools and important-action approvals

Implement bounded tools for file listing/reading/writing, terminal execution, app discovery/open/focus, UI inspection, screenshots, mouse and keyboard operations, and browser workflows. Prefer inspected UI elements over blind coordinates where available.

A tool broker enforces policy independently of the language model:

- Routine actions: inspect authorized app state, read nonsensitive files inside granted folders, and navigate within an authorized workflow.
- Important actions: deletion/overwrites, send/publish/submit, purchases, installations, permission/security changes, sensitive-data disclosure and commands or clicks with uncertain effects.
- Unknown actions require approval. Read-only does not automatically mean nonsensitive. Previously granted OS access does not authorize every future consequential action.

Show a chat approval card with bot, computer, target, action and consequence. Allow once authorizes immutable arguments for one task with expiry; changed arguments or stale target state require a new decision. Decline prevents execution. Persist approval state server-side so web and future mobile decisions cannot execute the action twice. Existing decorative message forms cannot grant OS permissions.

Provide Stop current task, Pause computer access, audit history and bounded output. Preserve the existing exact-command approval path until a typed routine tool has an enforced policy; do not let the model label arbitrary shell commands safe.

Acceptance: ownership checks, approval expiry/replay, argument changes, concurrent decisions, cancellation, revocation and cross-account isolation tests pass.

## Milestone 4 — Multi-step bot execution

Feed verified tool results back to the selected AI engine automatically so a bot can inspect, plan, act, observe and report. Keep this loop in a supervised backend worker rather than requiring an open chat tab. Use durable task state, leases, action/time budgets, cancellation and retry rules.

Show online, typing, working and awaiting approval states through WebSockets. Keep user drafts, emoji, uploads and the current layout. Never claim success merely because a click or command was attempted. Mark interrupted important actions uncertain and inspect before retrying.

Acceptance: a bot completes a real file/app workflow, pauses before its important step, continues only after Allow, and reports evidence. Browser closure does not lose the job or its pending decision.

## Milestone 5 — Voice, screen teaching, memory and schedules

Integrate existing speech, screen teaching, memory and scheduling with the native agent and durable task worker. Screen sharing is distinct from camera access. Record useful task outcomes in the correct bot's memory and keep source references. Surface model download/progress/failure states.

Schedules run while the server and required computer are available. Define missed-run behavior after downtime; prevent duplicate execution and do not replay uncertain important actions automatically. Scheduled jobs may pause awaiting approval and notify the account owner.

Acceptance: voice interaction, screen-only teaching, recall after restart, scheduled task execution, offline recovery and approval notifications work without an open chat page.

## Milestone 6 — Remote and mobile-ready access

Keep HTTPS, API authentication, account isolation and WebSocket reconnection independent of the web UI. Define mobile login/token lifecycle, device revocation and versioned message/task/approval contracts before writing the mobile client. Remote approval is authenticated and bound to the same immutable task as desktop approval.

Start remote access through a private network/VPN. A public relay can follow, with scoped authentication and no direct database/agent exposure. Plan native mobile push separately from existing browser notifications. The mobile client controls the connected Linux machine, not the phone OS.

Acceptance: a second authenticated device can message bots, observe progress, approve/decline exactly once and stop tasks. Offline computers and expired sessions are clearly shown.

## Delivery order

1. Production installer, private database, backup/restore.
2. Native Linux service and capability discovery.
3. Tool broker and enforced Allow / Decline cards.
4. Durable multi-step execution with live chat status.
5. Voice/screen/memory/scheduler integration.
6. Secure remote access and documented mobile API.

Preserve the working development stack and chats throughout. Test on a clean Linux host as well as the current development environment before calling the release Linux-ready. macOS, Windows, Electron packaging and the mobile UI are later milestones, not requirements for this release.
