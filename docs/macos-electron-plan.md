# Blew Chats: macOS Electron implementation plan

Status: proposed implementation sequence, 29 September 2026. This document does not mean desktop functionality has shipped.

## Product requirements

- Install a macOS application, with no Docker, Homebrew, Node, Go or Python setup required by the user.
- Preserve the current WhatsApp-inspired UI, account isolation, bot identities, profile, engine connections, formatted messages, files, voice, screen teaching, memory and schedules.
- First-run setup guides Accessibility, Screen Recording, Microphone, file access and notifications. Never request camera access. Screen sharing remains available.
- Bots operate native Mac apps, files, browser and terminal through explicit tools. Important actions stop at an Allow / Decline card in chat.
- Routine actions run only inside granted capabilities. Model-generated prose or an Allow-looking message form never authorizes OS execution.
- Target Apple Silicon first. Produce a separate Intel build after the Apple Silicon acceptance suite passes. Keep platform-neutral interfaces for future Windows/Linux adapters.

## Architecture decision

Use Electron with TypeScript and Electron Forge. Keep the existing Next.js UI/server and Go API initially. Package and supervise native runtime processes from the desktop app rather than rebuilding all backend functionality at once.

| Component | First macOS implementation |
| --- | --- |
| Interface | Existing Next.js standalone production output in an isolated Electron renderer |
| Desktop lifecycle | Electron main process: single instance, menu bar, windows, notifications, startup and shutdown |
| Web runtime | Bundled supported Node runtime; no dependency on the user's PATH |
| API | Bundled Go binary built for the target architecture |
| Database | Private bundled PostgreSQL 17 instance, with per-install credentials and private socket/loopback binding |
| Memory | Bundled Python runtime and local Qdrant/FastEmbed service; PostgreSQL remains authoritative |
| Speech | Bundled Whisper service; model download with progress, retry and offline state |
| Computer tools | Signed macOS native helper with Accessibility/Automation integration, brokered by Electron |
| Secrets | Keychain-backed desktop secret storage plus private per-account provider runtime directories |
| Scheduler | Supervised worker independent of the chat window, with durable job leases |

Existing PostgreSQL features include JSONB, generated text-search indexes, triggers, LISTEN/NOTIFY and transactional schedule claims. SQLite is not a drop-in replacement. Do not introduce a storage rewrite in this release; reassess footprint later.

App data lives under Electron's macOS userData directory. Separate account data, logs, model cache, helper state and credentials. Never write mutable data inside the signed .app bundle. Model caches may be shared; account conversations and tokens may not.

Local services bind only to private sockets or 127.0.0.1, use authenticated internal requests, validate origins, and are not exposed on the LAN. Decide the stable desktop origin and cookie/CSRF/WebSocket forwarding strategy in the first prototype. A custom app origin must preserve Next server actions, OAuth callbacks and WebSocket upgrades; do not assume static export will work.

## Milestones and acceptance gates

### 1. Desktop shell and packaging feasibility

Create desktop/ with Electron main/preload, Forge configuration, process supervisor, platform interfaces and typed IPC. Preserve the web layout. Enable renderer sandboxing and context isolation, disable Node integration, validate IPC senders/payloads and restrict navigation/new windows.

Prototype launching the bundled web/API/database stack on macOS. Use dynamic private ports where possible, readiness checks, bounded restart/backoff and useful startup failures. Verify pinned web dependencies and all native runtimes have arm64 artifacts and redistribution-compatible licenses. Record the actual minimum supported macOS version after checking those artifacts.

Acceptance: native window opens existing chats without a Docker daemon; closing/reopening the window does not duplicate services; a second launch focuses the existing app; unexpected child exit is recoverable. This is the first coding milestone.

### 2. Data and engine migration

Bundle private PostgreSQL initialization and migrations. Add a one-time explicit import of the existing Docker database, bot attachments, engine directories and schedules. Stop source writes during the final snapshot/import, retain a backup, verify row/file counts and never delete the source automatically. Rebuild semantic indexes from authoritative memory after import.

Resolve engine executables via packaged absolute paths. Keep Codex/Claude sessions separate per Blew account. Test supported external-browser login/device flows; reconnect when copied sessions cannot be safely reused. Do not assume browser cookies or all provider credentials are portable. Check provider distribution/auth requirements before bundling their CLIs.

Acceptance: profiles, bots, messages, files and schedules survive restart/import; account B cannot read account A's tokens, tools or memory; expired engine auth produces the existing alert.

### 3. First-run permission setup — no camera

Provide one onboarding page with explanation, current status, Grant and Skip per capability, plus a Settings page to revisit it.

- Accessibility: native app UI inspection, mouse and keyboard actions.
- Screen Recording: observation and screen teaching, with a visible sharing indicator and stop control.
- Microphone: live voice conversation.
- Files: choose accessible folders; explain protected-folder/Full Disk Access settings when required. Broad protected access is a user choice, not silently granted.
- Automation: request access to specific target apps when macOS requires it; it cannot all be granted upfront.
- Notifications: approvals, task completion, expired engine connection.
- Background/login launch: optional and explained separately.

Reject camera capture in Electron permission handlers and omit camera usage descriptions/entitlements. Do not confuse video display capture with webcam capture. Missing/revoked permissions disable the affected tool and show a repair action rather than repeatedly prompting.

Acceptance: fresh-install, skip, deny, grant, revoke and reopen flows work; no camera prompt appears during onboarding, voice or screen teaching.

### 4. Native Mac tools and enforced approvals

Replace manual local Linux pairing with an authenticated local-agent association established after the Blew account signs in and enables computer access. Revoke it on sign-out/account switch; retain remote pairing as a separate future-compatible path.

Implement typed tools for system information, app discovery, window/UI inspection, screenshots, launching/focusing apps, clicking/typing, file listing/reading/writing and bounded terminal execution. Prefer accessibility element identifiers over blind coordinates. Report unsupported apps or unavailable permissions honestly. External web pages stay isolated from the privileged app renderer.

The native broker enforces policy independently of the model:

- Routine: inspect permitted app state, list/read user-authorized nonsensitive folders and navigate within a granted workflow.
- Ask: delete/overwrite data, send or publish content, purchases/payment steps, installs, permissions/security changes, credential use, commands with unknown effects and ambiguous app clicks.
- Unknown classification always asks. Full-screen observation and file access still respect the scopes granted in setup; “read-only” is not automatically nonsensitive.

Approval cards identify the bot, target app/file, exact action and consequence. Bind Allow once to the account, task and immutable arguments with expiration; changed arguments or stale app state require a new decision. Decline prevents execution. Ordinary message-formatting buttons cannot call this approval path.

Return tool results to the bot automatically for the next step. Bound action loops with step/time budgets. Provide Stop current task and Pause all computer access. Log outcomes without recording tokens/passwords. Interrupted consequential actions are marked uncertain and inspected, not blindly repeated.

Acceptance: denied/expired/replayed/modified approvals cannot execute; account switching stops old access; an app workflow can inspect, prepare, ask, execute exactly once and verify its result.

### 5. Voice, screen teaching, memory and background work

Run bundled CPU speech and memory services with first-download progress, disk-space checks and recovery. Voice calls and screen teaching use the existing chat interface without a webcam. Route task/file results into each bot's persistent memory.

Keep scheduled jobs running when the window is closed if background mode is enabled. Explicit Quit or a sleeping/off Mac prevents execution; implement a visible missed-run policy on wake and prevent duplicate leases. Do not silently enable wake-from-sleep or login launch.

Acceptance: voice round trip, screen-only teaching, semantic recall after restart, notification delivery, foreground/background schedule runs, sleep/wake and offline recovery.

### 6. Signed release and clean-Mac verification

Produce a direct-download .dmg first, rather than starting with Mac App Store sandbox constraints. Sign all executables/helpers with a stable Developer ID identity, apply narrowly required hardened-runtime entitlements, notarize and staple. Add signed updates with backup/migration recovery and clear version diagnostics.

Release signing/notarization requires the owner's Apple Developer credentials; use secure build secrets, never repository files. Unsigned development builds can be tested earlier, but are not a notarized public release.

Acceptance: install on a clean Apple Silicon Mac without developer runtimes or Docker; exercise first-run permissions, engine login, real native-app tasks, approval decline, restart, update, migration and uninstall/data-retention behavior. Build and test Intel separately before advertising it.

## Planned code ownership boundaries

- desktop/: Electron lifecycle, preload, IPC contracts, packaging, permission UX bridge, runtime supervisor and approval broker.
- desktop/native/macos/: signed native helper and macOS OS/tool adapters.
- web/: preserve layout; add onboarding/settings surfaces, desktop notification adapter and genuine task approval cards.
- api/: private desktop configuration, local-agent account binding, tool records/approval transactions, background result continuation and migration support.
- memory/, speech/: configurable native data/model paths and bundled service builds.
- scripts/desktop/: runtime acquisition/checksums, architecture builds, backup/import and release validation.

## Release definition

A final desktop release is not merely an Electron window pointed at localhost:3001. It must start its own native services without Docker, preserve account isolation and existing data, operate real Mac apps with enforced approval decisions, never request a camera, and pass a signed clean-machine installation test.

## References checked

- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron macOS permission APIs: https://www.electronjs.org/docs/latest/api/system-preferences
- Electron Forge signing/notarization: https://www.electronforge.io/guides/code-signing/code-signing-macos
- Apple Accessibility permission: https://support.apple.com/en-mn/guide/mac-help/mh43185/mac
