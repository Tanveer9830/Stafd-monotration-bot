# TANVEER STAFF MONITOR

> **MADE BY TANVEER** · Creator Discord: `tanveer5637`  
> Permanent footer: `⚡ Made by Tanveer | Discord: tanveer5637`  
> Permanent Global Owner Discord user ID: `1131248987173814336`

**TANVEER STAFF MONITOR** is a multi-server Discord staff accountability platform: live ticket capture, five-minute first-responder automatic claims, evidence-based activity monitoring, human-approved warnings, leave management, analytics, reports and a full website dashboard. It is built with Node.js, TypeScript, `discord.js` v14 and transactional SQLite (WAL, versioned migrations, Postgres-ready repository boundary).

---

## What is included

| Area | Implementation |
|---|---|
| **Slash commands** | Exactly **100 operations** across **18 roots** (`/owner`, `/admin`, `/server`, `/staff`, `/activity`, `/ticket`, `/monitor`, `/scan`, `/review`, `/warning`, `/appeal`, `/leave`, `/analytics`, `/report`, `/integration`, `/settings`, `/system`, `/help`). No aliases, no hidden operations. See [`COMMANDS.md`](COMMANDS.md). |
| **Website dashboard** | Discord OAuth2, hashed server-side sessions, CSRF, same-origin enforcement, SSE live updates, 26 pages. See [`docs/WEBSITE_DASHBOARD.md`](docs/WEBSITE_DASHBOARD.md). |
| **Authorization** | Permanent Global Owner by exact ID; explicit Global Administrator scopes; Server Owner verified from live Discord; Server Co-Owner/Admin/Viewer website roles; backend enforcement on every route, command, button and stream. See [`docs/ACCESS_ROLES.md`](docs/ACCESS_ROLES.md). |
| **Access & Roles panel** | Assign/edit/suspend/revoke, explicit scopes, expiration, role templates, permission matrix, audit history, self-promotion and escalation prevention. |
| **Staff discovery** | Multi-role paginated picker with search and persisted selections (100+ roles), role IDs, dedupe, coverage reporting, `NEW STAFF` status. |
| **Tickets** | Live browser, ticket detail with captured conversation and event timeline, number search, filters, adapter diagnostics, modular integrations. |
| **Automatic claim** | Persistent five-minute first-responder timers (configurable 1–120), concurrency-safe execution, cancellation on manual claim/close, `MANUAL` vs `AUTOMATIC` labels. |
| **Monitoring** | `ACTIVE`, `AT_RISK`, `INACTIVE`, `ON_LEAVE`, `UNKNOWN`, `NEW_STAFF`, `INSUFFICIENT_WORKLOAD`, `MONITORING_ERROR`; default 24h/48h/72h; six-hour scans; no automatic punishment. |
| **Analytics & reports** | Server analytics, fairness-adjusted staff performance, daily/weekly/monthly reports, CSV/PNG/PDF exports. Global analytics only for the Global Owner (or an explicit `GLOBAL_ANALYTICS` grant). |
| **Operations** | Verified backups, restore, migrations, system health, session security, optional reverse-proxy deployment on Ubuntu VPS or Pterodactyl. |

---

## Safety guarantees

1. **Immutable identity.** The Global Owner is matched only by exact ID `1131248987173814336` in `src/config/branding.ts`. A username, nickname, Discord role, guild ownership or Administrator permission never grants Global Owner. It cannot be changed by commands, settings, website screens or the environment.
2. **Guild isolation.** Every guild-scoped query includes `guild_id`. Server Owners see their own server only; Global Administrators receive no cross-server data unless explicitly granted.
3. **Human decisions.** Inactivity creates a review, never a warning. Warnings never auto-kick, auto-ban or auto-demote. Approved leave pauses inactivity scoring.
4. **Honest coverage.** Scans and diagnostics report `FULL`, `PARTIAL` or `UNAVAILABLE`. Missing intents or permissions are surfaced; message content is marked unavailable rather than invented.
5. **Privacy.** Message Content is optional and off by default. Transcript access requires `SERVER_VIEW_TRANSCRIPTS` and is audited.
6. **No fabricated UI.** Every dashboard page reads a real endpoint. There are no sample rows, demo statistics or placeholder buttons. Integration secrets are write-only.
7. **No secrets in logs or Git.** `.env` is ignored; pino redacts tokens; backups contain the database only.

---

## Quick start

**Requirements:** Node.js `>= 20` (22 LTS recommended), build tools for native modules, and a Discord application.

```bash
npm install
npm run setup        # guided, never overwrites an existing .env
npm run build
npm start
```

The process starts the Discord bot and the website dashboard together.

### Minimum `.env`

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...              # dashboard OAuth2
WEB_BASE_URL=http://localhost:3000
OAUTH2_REDIRECT_URI=http://localhost:3000/auth/callback
```

Add the exact redirect URL in Discord Developer Portal → OAuth2 → Redirects. Full variable list: [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md).

Then in Discord:

```text
/server setup
/staff add
/ticket setup
/scan now
```

---

## Documentation

| Guide | Path |
|---|---|
| Command reference (all 100 operations) | [`COMMANDS.md`](COMMANDS.md) |
| Installation & Discord portal setup | [`docs/INSTALLATION.md`](docs/INSTALLATION.md) |
| Discord intents, invite and OAuth2 | [`docs/DISCORD_SETUP.md`](docs/DISCORD_SETUP.md) |
| Environment variables | [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) |
| Website dashboard (OAuth2, sessions, CSRF, SSE, 26 pages, API) | [`docs/WEBSITE_DASHBOARD.md`](docs/WEBSITE_DASHBOARD.md) |
| Access & Roles / permission model | [`docs/ACCESS_ROLES.md`](docs/ACCESS_ROLES.md) |
| Ticket integrations & automatic claim | [`docs/TICKET_INTEGRATIONS.md`](docs/TICKET_INTEGRATIONS.md) |
| Production deployment (Ubuntu VPS, Pterodactyl, reverse proxy) | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Backup & recovery | [`docs/BACKUP_AND_RECOVERY.md`](docs/BACKUP_AND_RECOVERY.md) |
| Troubleshooting | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |

---

## Verification

```bash
npm run typecheck   # tsc --noEmit
npm test            # command count, authorization, roster, tickets, website session/CSRF tests
npm run build       # compiles and copies public assets into dist/public
```

The test suite asserts exactly 100 operations across 18 roots. Website HTTP tests start a real server against a temporary SQLite database and verify unauthenticated rejection, CSRF enforcement, global-data denial, guild isolation and immediate session revocation.

> **Not exercised live in this environment:** Discord OAuth2 token exchange, a real Discord gateway connection, and real guild/member API calls require your credentials. Configure them and test `/server setup`, `/staff add` and dashboard sign-in in your own server. Unit/integration tests use a real temporary SQLite database and a stubbed Discord delivery adapter.

---

## CLI

```bash
npm run setup             # safe installer
npm run migrate           # apply migrations
npm run build             # production build + dashboard assets
npm start                 # bot + dashboard
npm run deploy:commands   # register the 18 roots / 100 operations
npm run backup            # verified SQLite snapshot
npm run restore -- <file> # restore with a pre-restore backup
npm test                  # Vitest suite
```

---

*⚡ Made by Tanveer | Discord: tanveer5637*
