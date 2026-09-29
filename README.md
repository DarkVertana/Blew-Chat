# blew (Blew Chats)

Next.js + Go + Postgres, wired together with Docker Compose, with email/password
authentication and server-side sessions.

## Layout

| Path                    | What                                                                 |
| ----------------------- | -------------------------------------------------------------------- |
| `web/`                  | Next.js 16 (App Router, TypeScript, Tailwind v4, lucide-react), pnpm |
| `api/`                  | Go 1.27 HTTP API (`net/http` + `pgx`, bcrypt)                        |
| `api/migrations/`       | SQL migrations, embedded in the binary and applied at startup        |
| `compose.yaml`          | Base stack with production image targets                             |
| `compose.override.yaml` | Dev overrides (bind mounts, hot reload); merged automatically        |
| `.env.example`          | Ports and database credentials; copy to `.env`                       |

## Prerequisites

Docker Desktop, OrbStack, or Colima. Go and Node are only needed to run a service outside Docker.

Development uses one-second file polling for Next.js (Webpack) and Air, so edits and new files reload automatically across macOS/Colima bind mounts.

## Quick start

```sh
cp .env.example .env   # once
make up                # = docker compose up --build
```

| Service  | URL                            |
| -------- | ------------------------------ |
| web      | http://localhost:3000          |
| api      | http://localhost:8080/health   |
| postgres | localhost:5432 (blew / blew)   |

If any of those ports is already taken on your machine, change `WEB_PORT`, `API_PORT`, or `POSTGRES_PORT` in `.env` and run `make up` again. Container-side ports never change.

Open the web URL, create an account at `/register`, and you land on the chat UI.

Edit files under `web/` or `api/` and both services reload: Next.js via `next dev`, Go via [air](https://github.com/air-verse/air).

## Pages

| Path                     | What                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/` | Account-owned AI coworkers: create a bot, persistent chat, live voice, screen teaching and approved Linux tasks. |
| `/settings`              | Settings root: search, notifications tip, mood avatar, and the Profile / Account / Privacy / Chats / Notifications / Help / Log out rows                                |
| `/settings/chats`        | Theme (System default, Light, Dark), Wallpaper (colour + doodles), media rows, toggles. Theme and wallpaper apply immediately and persist in localStorage                |
| `/settings/account`      | The real, API-backed security page: change password, active sessions with revoke, sign out everywhere, recent activity                                                 |
| `/settings/*` others     | Profile, Privacy, Notifications, Help: frontend-only panels                                                                                                             |
| `/calls`, `/status`, `/communities`, `/ai` | Placeholder panels reached from the rail                                                                                                             |
| `/notes`                 | The original notes demo, wired to the API                                                                                                                              |
| `/login`, `/register`    | Auth pages                                                                                                                                                             |

Theme: `<html data-theme>` is set before paint by a nonce'd inline script in `web/src/app/layout.tsx` from the device preference or the saved choice; both the chat palette (`--wa-*` variables in `globals.css`) and Tailwind's `dark:` variant key off it.

## How the pieces talk

```
browser ──> Next.js (server components + server actions) ──> Go API ──> Postgres
             web:3000              API_URL=http://api:8080     DATABASE_URL
```

The browser only talks to Next.js. Next.js calls the Go API server-side over the compose network, so there is no `NEXT_PUBLIC_*` API URL baked into the build and no CORS in the normal path. `CORS_ORIGIN` on the API exists for calling it directly from a browser during development.

## Authentication and security

- **Accounts** are email + password. Passwords are hashed with bcrypt and must be at least 12 characters, use 3 of 4 character classes (lowercase, uppercase, digits, symbols), not be a common password, and not contain your email. The register and change-password forms show a live checklist and the API's exact reasons on rejection.
- **Sessions** are random 256-bit tokens that expire after 7 days. Postgres stores only a SHA-256 hash of each token plus the IP, user agent and last-seen time. `/settings` lists active sessions with revoke buttons and a "sign out everywhere" action. Changing your password signs out every other session.
- **The cookie** `blew_session` is set by Next.js server actions on its own origin: httpOnly, SameSite=Lax, and Secure in production. Server components and actions forward it to the API as `Authorization: Bearer <token>`. The browser never sees the token or the API.
- **Route guard**: `web/src/proxy.ts` redirects requests without the cookie to `/login`. Pages then call `requireUser()`, which validates the session against the API, so a stale cookie also ends up at `/login`.
- **Rate limiting**, per client IP, in the API: 40 requests burst then 20/s on everything, and 5 burst then 10/min on login, register and password change. Responses are 429 with `Retry-After`.
- **Login lockout**, in Postgres so it survives restarts and spans instances: 5 failed attempts for an account or 20 from one IP within 15 minutes blocks sign-in for the rest of the window. A successful sign-in clears the account's streak without erasing its IP's failed-attempt history. Attempt checks and recording are serialized per account and IP across API instances. Unknown emails take as long as wrong passwords, so timing does not reveal which accounts exist.
- **Activity log**: every API request except `/health` is written to `audit_log` (user, action, method, path, status, duration, IP, user agent, metadata) by a background writer, so requests never wait on it. Users see their own recent activity on `/settings`. Query the table directly for anything else, e.g. `select action, ip, count(*) from audit_log group by 1, 2`.
- **Client IP**: The API ignores `X-Forwarded-For` by default, so Next.js requests share the web container's IP rate-limit budget. This prevents clients from bypassing limits by inventing forwarding headers. To enable per-browser IP limits, place Next.js behind an edge proxy that overwrites `X-Forwarded-For`, block direct public access to Next.js and the API, and set `TRUSTED_PROXY_CIDRS` to the actual Next.js peer and trusted edge proxy ranges. The API then chooses the rightmost untrusted hop. Do not enable broad private-network trust on an exposed service.
- **Headers**: the web app sends a nonce-based Content-Security-Policy (from `proxy.ts`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production. The API answers with `nosniff`, `Cache-Control: no-store`, a deny-all CSP and `frame-ancestors 'none'`. Panics become a logged 500 instead of a dropped connection.
- **Notes are per user.** Each note belongs to the account that created it.

Not included yet: password reset, email verification, two-factor auth, breached-password lookup (e.g. Have I Been Pwned).

## API

All bodies and responses are JSON. Authenticated routes need `Authorization: Bearer <token>`.

| Method | Path                 | Auth | Notes                                                                 |
| ------ | -------------------- | ---- | --------------------------------------------------------------------- |
| GET    | `/health`            | no   | 200 when Postgres answers, else 503                                   |
| POST   | `/api/auth/register` | no   | `{email, password}` → 201 `{token, expires_at, user}`; 400 `{error, problems}` for a weak password; 409 if taken |
| POST   | `/api/auth/login`    | no   | `{email, password}` → 200 `{token, expires_at, user}`; 401 otherwise; 429 when locked or rate limited |
| POST   | `/api/auth/logout`   | yes  | Deletes the session → 204                                             |
| POST   | `/api/auth/logout-all` | yes | Deletes every session of the user → 204                              |
| POST   | `/api/auth/password` | yes  | `{current_password, new_password}`; signs out other sessions → 204     |
| GET    | `/api/auth/sessions` | yes  | Active sessions with ip, user agent, last seen, `current` flag        |
| DELETE | `/api/auth/sessions/{id}` | yes | Revoke one session → 204                                          |
| GET    | `/api/auth/activity` | yes  | Your last 50 audit log rows                                           |
| GET    | `/api/auth/me`       | yes  | The current user                                                      |
| GET    | `/api/notes`         | yes  | Your latest 100 notes                                                 |
| POST   | `/api/notes`         | yes  | `{body}`, 1–1000 characters → 201                                     |

## Commands

Run `make help` for the full list.

| Command          | Does                                                    |
| ---------------- | ------------------------------------------------------- |
| `make up`        | Start the dev stack in the foreground                   |
| `make down`      | Stop it                                                 |
| `make reset`     | Stop and delete volumes (wipes the database)            |
| `make logs`      | Tail all logs                                           |
| `make test`      | Go unit/integration tests plus web tests, lint and typecheck |
| `make psql`      | psql shell into the database                            |
| `make prod-up`   | Build and run production images in the background       |

## Production images

`make prod-up` uses only `compose.yaml`, so no bind mounts and the `prod` Dockerfile targets:

- **api**: static Go binary on `gcr.io/distroless/static`, non-root. The binary doubles as its own healthcheck (`server -healthcheck`) since the image has no shell.
- **web**: `next build` with `output: "standalone"`, served by `node server.js` as a non-root user. The session cookie is marked Secure, which browsers accept on `http://localhost` but not on other plain-http hosts, so put a TLS terminator in front for real deployments.

## Database migrations

On startup the API applies every `api/migrations/*.sql` file that is not yet listed in the `schema_migrations` table, in filename order, each inside a transaction and under an advisory lock so several instances cannot race. To change the schema, add a new `NNN_name.sql` file; never edit one that has already been applied. `make reset` wipes the volume if you want to start over.

## Running a service outside Docker

```sh
docker compose up db                       # just Postgres

cd api && DATABASE_URL='postgres://blew:blew@localhost:5432/blew?sslmode=disable' go run ./cmd/server
cd web && API_URL=http://localhost:8080 pnpm dev
```

Auth integration tests use isolated temporary PostgreSQL schemas and remove them afterward. `make test` supplies `TEST_DATABASE_URL` from the API container's database configuration. Outside Docker, set `TEST_DATABASE_URL` explicitly to enable these tests; otherwise they are skipped.

## User profiles

Settings → Profile saves a display name, About text and a private profile image to PostgreSQL. Names accept 1–100 characters. About is stored as TEXT without an application character limit, preserving newlines and whitespace; its streamed route bypasses Server Action and proxy-buffer body caps. Infrastructure timeouts, memory and PostgreSQL's storage limits still apply.

Authenticated endpoints: `GET /api/profile`, `PUT /api/profile` with `{name, about}`, and `GET`, `PUT`, `DELETE /api/profile/image`. Image PUT takes raw JPEG/PNG bytes (up to 5 MiB and 4096 × 4096 pixels). Images are validated and stored in the database, served only to their owner with private/no-store headers. The same-origin Next.js routes keep session tokens server-side and reject cross-origin mutations. Migration `004_profiles.sql` adds the storage without changing existing accounts.

## Browser notifications

Settings → Notifications saves account-level message/group/status, preview and sound preferences in PostgreSQL; these default to on. Browser permission is separate: click **Enable browser notifications**, choose **Allow**, then **Send test notification**. Settings and chat reminder banners disappear when browser permission is granted. Blocked permissions show recovery instructions, and stalled browser setup returns an error instead of waiting forever.

The Go API encrypts Web Push messages using VAPID keys generated once and persisted in `web_push_keys`. Subscriptions belong to an authenticated session and cascade away when it is revoked. The service worker rechecks the current account, subscription and preferences before displaying a queued push; it does not cache application data. Only supported browser-vendor HTTPS push endpoints are accepted. Expired subscriptions are removed on delivery. Preview suppression and silent notifications are respected; audible playback still depends on the browser and OS.

Use HTTPS in production and set `WEB_PUSH_SUBJECT` to your real public HTTPS URL or `mailto:` contact before creating the API container. The localhost fallback is for development and is not accepted by Safari's push service. iOS/iPadOS Web Push requires a supported OS and adding the app to the Home Screen; a standalone manifest and icons are included. Protect database backups because they now contain the private VAPID key as well as user data.

Authenticated API: `GET/PUT /api/notifications`, `PUT/DELETE /api/notifications/subscription`, and rate-limited `POST /api/notifications/test`. The test goes only to the current login's browser. `sendPush` is the backend delivery entry point for future real message/group/status events. Automatic bot-reply push notifications are not currently dispatched.

## AI Engine connections

Settings → Engine (`/settings/engine`) connects a user's own provider accounts and saves their default provider/model. Codex uses the official app-server's ChatGPT device-code flow. Enable device-code login in the provider account if required. Claude Code uses the official CLI's browser OAuth flow and asks for the returned confirmation code. Both clients own token storage/refresh; Blew never extracts tokens or impersonates a different client. Claude subscription eligibility and usage billing follow Anthropic's current rules; Max-included usage for third-party tools is not guaranteed.

API-key connections include OpenAI, Anthropic, Google Gemini, Groq, Mistral, DeepSeek, xAI, and OpenRouter. Keys are verified with each provider's model-list endpoint and model lists refresh on demand. API billing is separate from subscription plans. Model listing verifies authentication, not the ability or budget to generate with every returned model. No paid inference request is made by setup. Account-owned bots generate replies through the selected Engine. Choose a chat-capable model; screen teaching additionally requires image input support.

The Next.js server owns this integration through authenticated Server Actions, revalidates the Blew session for every operation, and derives the storage account from that session. API secrets and selection live in AES-256-GCM encrypted files with per-account keys; official client credentials live in private per-account directories. No keys/tokens are returned to the browser or put in localStorage. Pending logins expire, same-account operations serialize, and Disconnect removes that provider's local credentials and clears its default selection. Signing out of Blew ends access through that session but preserves the account's Engine connections for its next login.

`ENGINE_DATA_DIR` defaults to `.engine-data` outside Docker (gitignored). Docker mounts `/var/lib/blew-engines` from `engine-dev-data` in development and `engine-data` in production; these environments intentionally have separate credentials. Back up and protect that volume along with the database. Encryption keys are in the same protected volume, so encryption does not protect against compromise of the host or a full volume backup. `make reset` deletes these volumes as well as the database. Use one web instance with this file-backed implementation; multiple replicas require shared credential storage and distributed locking before deployment. Official client versions are pinned in the web Dockerfile; running web outside Docker also requires those clients on PATH.

Chats and Settings show an Engine setup/reconnect banner when no default engine is selected or its authentication needs attention. A shell-level provider checks on focus and every minute while visible; a successful Engine change forces an immediate check. Valid connections hide the banner. API 401/403 responses and expired/missing client credentials request reconnection; network/rate-limit failures show a retry state and never erase saved credentials. Codex asks its official client to refresh tokens; Claude reads expiry metadata after its official status command. Claude status is not a paid inference check and cannot prove immediate remote revocation before the provider reports it. Each account's selected provider is monitored independently.


## AI coworkers, Linux control and calls

Use **New chat** to create a bot with a name, designation, photo and instructions. Conversations persist in PostgreSQL and every resource is scoped to the authenticated account. Bot context includes that bot’s identity/instructions and the current user’s Profile name/About. Stored text is not a guarantee of unlimited model context: the latest 50 completed turns are bounded to 120,000 characters, bot instructions to 32,000, and Profile About to 24,000 for each inference. History pagination retains older messages. Failed turns can be retried without duplicate completed replies.

The phone button starts a half-duplex voice session: microphone → CPU Whisper tiny → selected Engine → browser speech synthesis. Listening pauses during processing/playback; Interrupt / Resume stops speech and resumes listening. This is not a separate conversational small language model: Whisper is speech recognition, while reasoning uses the chosen Engine (select a smaller provider model for lower latency). Microphone audio is transient; transcripts persist as chat messages. The private Compose `speech` service downloads its model on first use into `speech-models`. HTTPS or localhost and browser microphone permission are required. Speech voices depend on the browser/OS.

The video button starts **screen teaching plus voice**. The browser lets the user select a screen/window/tab; one resized JPEG is sent with each message or voice turn. This is not continuous video inference or a webcam avatar call. Frames are not persisted by Blew. An optional screen demonstration downloads locally (60 seconds maximum); it is not automatically uploaded or used for model training. “Remember this” appends a chosen assistant explanation to that bot’s saved instructions. The selected model must support images.

The computer button pairs a Linux machine using a single-use five-minute code. Download `web/public/blew-linux-companion.mjs`, run `node blew-linux-companion.mjs --pair` on Linux with Node.js 24+, enter the Blew origin and pairing code, and keep it running. Remote origins require HTTPS. The companion stores its device token privately in `~/.config/blew-code/companion.json`; tokens are hashed in the server database. Each device belongs to one Blew account and can only claim that account’s approved tasks.

Models propose commands in chat; the user reviews the exact command and clicks **Approve and run**. Execution is through `/bin/sh`, with the companion’s Linux user permissions, a 90-second timeout and bounded output. This supports files, development tools and system utilities accessible to that user; it does not grant root, install GUI-control utilities or bypass Linux permissions. Run the companion in the desktop session for installed desktop automation commands to work. Browser screen sharing alone does not grant computer control. Cancelling/disconnecting is checked every two seconds; connectivity loss terminates the active process group. Commands that deliberately detach or start system services may outlive that process group. Lost tasks are never automatically rerun. Task outputs are available to subsequent bot replies.

Chat model runtimes have direct shell/edit/MCP tools disabled; host work goes through the separate approval queue. Credentials and other accounts’ files are not included in prompts. Keep one web replica for the in-process Engine locks. Integrations that need multiple replicas require a distributed execution lock/queue.

Reference designs reviewed: [OpenMausBot desktop companion](https://github.com/milind-soni/OpenMausBot/blob/main/docs/desktop-companion.md), its [historical voice workflow](https://github.com/milind-soni/OpenMausBot/blob/main/docs/voice-mode.md), and [Rakazo](https://github.com/elie222/rakazo). Blew’s implementation is independent and uses its own account-scoped pairing and approval protocol.

## Per-bot scheduled tasks

Open **Tasks & schedules** from each chat’s three-dot menu or contact info. Create a one-time date/time or a standard five-field cron job with an IANA timezone, preview the next three occurrences, then enable it. Daily, weekday, hourly and monthly presets are included. One-time date entry uses the browser’s displayed local timezone; cron uses the saved timezone. Standard cron ranges, lists and steps are supported; `L`, `W`, `#`, seconds and shell expressions are not. Nonexistent calendar dates and DST-gap times are skipped by the cron parser; repeated wall-clock hours may have two matching occurrences. Date previews and execution use the same parser.

The bot can propose a schedule from a chat request. **Review schedule** opens the editor and nothing runs until enabled. AI-created proposals cannot grant Linux command permission. An **Ask this bot** job uses the owning account’s current Engine, profile, bot instructions and bounded chat context, then saves its reply in that bot’s chat. A **Run an approved Linux command** job requires the owner to select their own paired computer and approve the exact command at creation/edit time; that fixed command then dispatches automatically. Newly generated commands from an AI job still require the normal in-chat approval.

Schedules and run receipts persist in PostgreSQL. The Next.js Node server polls every 15 seconds, even with all browsers closed; deploy as a continuously running Docker service, not a request-only/serverless function. Both API and web must share a random `SCHEDULER_SECRET` of at least 32 characters. Set it in the ignored `.env` (generate with `openssl rand -hex 32`) and restart both services; never use a `NEXT_PUBLIC_` variable. Missing configuration disables the worker and is shown in the editor. Internal claim/active/finish endpoints require this credential; browser sessions cannot call them. Keep the existing single-web-replica constraint for account Engine locks. Only one AI job is processed globally at a time in this initial scheduler, so jobs may start late behind longer work.

Transactions lock the schedule and bot and prevent overlapping runs. After downtime, one missed occurrence up to 12 hours late is dispatched; older ones get a missed receipt. Subsequent cron dates advance from dispatch time instead of replaying every missed minute. An offline Linux machine produces a failed receipt rather than a deferred surprise command. A crashed worker becomes a failed run after five minutes and is never silently retried. **Run now** requests one extra occurrence without resuming a paused series or shifting its recurring date. **Pause & stop** cancels active/queued work, invalidates pending AI results, and signals the Linux companion to stop; a provider request already in flight may still consume usage. **Remove** soft-deletes the schedule and preserves history. Future runs use edited definitions; run receipts keep the original title/prompt. The editor shows the latest 30 runs.

Reference: [OpenMausBot routine schedules](https://github.com/milind-soni/OpenMausBot/blob/main/docs/routine-schedules.md). Blew uses its own PostgreSQL claims and the Go cron parser rather than copying the reference implementation.

### Chat attachments and Linux file inspection

The original WhatsApp-style composer retains Emoji and a + menu with Photos & files, screen teaching, schedules and Linux computer. Upload up to four files per message, 10 MiB each; storage is limited to 250 MiB per bot. Files are stored privately in PostgreSQL, scoped to the owning account and bot, attached atomically to a message, and downloaded as attachments with nosniff. Removing a draft deletes its uploaded bytes. Sent files remain with their chat.

JPEG/PNG up to 5 MiB and UTF-8 text/code are passed directly to the selected engine (one image, first 16 KB per text file). Other formats remain intact. A bot can propose an approved Linux inspection command using the provided `BLEW_FILE_<attachment-id>` variable. After approval, the latest companion downloads only the referenced files from that bot, while the task is running, into private local `task-files` directories; it supplies absolute paths through those variables. Download access stops after cancellation, completion or computer revocation. Copies already downloaded stay on Linux until the owner removes them. Replace/restart older companions to use this capability; pairing is retained.

This enables format-specific tools such as PDF extraction, office conversion, archive listing, media inspection and OCR when installed on Linux. Opening a GUI does not give the bot visual access: share screen frames for that. Encrypted, corrupt or proprietary formats may still need passwords or suitable software. Uploaded scripts/macros are not executed merely for inspection. Task output returns to chat; **Analyse result** asks the bot to interpret it using the same account’s Engine.

### Persistent bot memory

Each bot has its own **Bot memory** panel in its chat menu and contact info. **Remember this** saves a durable note instead of growing the bot's instructions. Search past conversations, file contents/references and Linux task outputs, add a note, or exclude a source from long-term recall. Exclusion keeps the original chat/file intact and does not erase recent working context.

PostgreSQL transaction triggers archive all stored turns, text attachments and completed task results as overlapping Unicode text chunks, including pre-existing history. No conversation-count cutoff deletes old memories. A private single-process Python service uses open-source **Qdrant** local mode and **FastEmbed** (`BAAI/bge-small-en-v1.5`, CPU/ONNX) for semantic retrieval. Model weights are downloaded once and cached locally; embedding text is not sent to a third-party embedding API. The API combines semantic results with indexed keyword search, recent events and saved notes, then revalidates every result against live bot ownership, revision and exclusions. Semantic search uses account and bot filters as an additional boundary. Normal, voice and scheduled replies use retrieved context. Binary file content is not fabricated: file references enable approved Linux inspection, and returned text becomes searchable memory.

Start/rebuild with `docker compose up -d --build`. Set a random `MEMORY_SECRET` of at least 32 characters in `.env`. The memory service has no published host port. Back up `db-data`, `memory-data` and `memory-models`; PostgreSQL is authoritative, and a missing vector collection reindexes automatically. Run one memory worker per local Qdrant directory. Keyword recall stays available while the model warms or semantic indexing is unavailable. The small embedding model is English-focused; other languages retain keyword matching. New/changed memories index asynchronously. History retention is bounded by available storage, not a model context window; each generation still receives a finite relevance-selected context and recall is not guaranteed perfect.

### Live chat and interactive messages

Chat changes publish through PostgreSQL `LISTEN/NOTIFY` and authenticated same-origin WebSockets at `/api/live/bots/:id`. Next.js proxies upgrades to Go. The WebSocket checks the exact configured `CORS_ORIGIN`, chat ownership and the HttpOnly session, and closes revoked/expired sessions. Reverse proxies must forward WebSocket Upgrade/Connection headers. Clients reconnect automatically, fetch snapshots on reconnect/tab wake, and use polling only when disconnected. Optimistic sends remain visible, stale pending snapshots cannot replace completed replies, and the scroll pane keeps the composer on-screen without dragging users away from older messages.

Message bubbles render safe Markdown (bold, italic, lists, code, tables, links and `++underline++`) without raw HTML execution. Bots can emit one validated `blew-ui` JSON form per reply with radio choices, dropdowns, checkboxes, text, multiline, number/date fields and action buttons. Clicking submits a normal chat response. Form answers are linked to their source turn, survive reloads and reject duplicate submissions. These controls do not approve Linux commands, execute arbitrary scripts, navigate, make payments or place orders. Existing messages gain text formatting; interactive controls appear in new replies when the bot emits the supported schema.
