# TANVEER STAFF MONITOR

> **MADE BY TANVEER** · Creator Discord: `tanveer5637`  
> Permanent Footer: `⚡ Made by Tanveer | Discord: tanveer5637`  
> Permanent Global Owner Discord User ID: `1131248987173814336`

**TANVEER STAFF MONITOR** is a production-grade, multi-server Discord Staff Management, Ticket Monitoring, Inactivity Detection, Human-Approval Warning, and Executive Analytics Platform built with Node.js, TypeScript, `discord.js` v14, and transactional SQLite (`better-sqlite3` in WAL mode with PostgreSQL-ready repository abstractions).

---

## Core Guarantees & Safety Principles

1. **Immutable Creator & Global Owner Identity**
   - Permanent project branding (`TANVEER STAFF MONITOR`, `MADE BY TANVEER`, footer `⚡ Made by Tanveer | Discord: tanveer5637`) is embedded across every Discord embed, dashboard, notification, PNG visual card, and PDF report, and cannot be removed or altered via runtime commands or guild settings.
   - Global Owner privileges are authenticated **exclusively** against exact Discord User ID `"1131248987173814336"` (`src/config/branding.ts`, `src/services/PermissionService.ts`) — never by username, display name, nickname, role name, server ownership, or Discord `Administrator` permission.
2. **Strict Multi-Guild Isolation & Role-ID Security**
   - Every guild table enforces `guild_id` scoping.
   - Actual Discord Guild Owners (`guild.ownerId`) automatically receive full **local** server administration for their own server only (dynamically synced on ownership transfer) without gaining Global Owner powers or cross-server visibility.
   - Co-Owners and management reviewers are authorized strictly by configured Discord User IDs or Role IDs — never by role names.
3. **Evidence-Based Activity & Zero False Warnings**
   - Tracks real, verifiable staff work (ticket responses, ticket resolutions, support replies, moderation actions, management reviews, and configured work channels) while filtering bots, webhooks, rapid spam, presence-only changes, and claiming a ticket without meaningful follow-up work.
   - Stores event metadata and snowflake IDs rather than raw message bodies; `MessageContent` and `GuildPresences` privileged intents are **disabled by default**.
   - Never flags staff during initial baseline observation windows, approved leave (`🔵 ON LEAVE`), zero server-wide ticket/support demand (`🟠 INSUFFICIENT WORKLOAD`), `🆕 NEW STAFF` grace periods, or `PARTIAL` / `UNAVAILABLE` monitoring coverage (`⚪ UNKNOWN`, `🚨 MONITORING ERROR`).
   - Automatically cancels pending warning reviews and notifies reviewers if a staff member resumes qualifying work before approval.
4. **100% Human-Approved Warnings & Zero Automatic Punishments**
   - **Never automatically issues a warning.** Every inactivity incident creates a persistent review card (`APPROVE WARNING`, `REJECT`, `REVIEW LATER`, `MARK EXCUSED`) surviving restarts in SQLite.
   - Supports 4 configurable approval policies (`GLOBAL_OWNER_REQUIRED`, `ANY_AUTHORIZED_REVIEWER`, `TWO_PERSON_APPROVAL`, `GLOBAL_OWNER_AND_GUILD_OWNER`), executes a 14-step pre-warning recheck, requires final confirmation, and records the **actual** human approver (never attributing approval to Tanveer unless User ID `1131248987173814336` personally approved it).
   - Progressive warnings (`1/3`, `2/3`, `3/3 — Final warning / Management review`) **never** auto-kick, auto-ban, auto-demote, or auto-remove roles.

---

## Feature Architecture

### 1. Slash Command Suite (51 Subcommands + `/dashboard`)
| Root Command | Subcommands |
|---|---|
| `/owner` | `panel`, `admin add`, `admin remove`, `admin list`, `guilds`, `guild-info`, `features`, `global-stats`, `audit` |
| `/staff` | `setup`, `scan`, `list`, `active`, `inactive`, `at-risk`, `unknown`, `profile`, `activity`, `history`, `roles add`, `roles remove`, `roles list`, `report`, `analytics`, `coverage` |
| `/ticket` | `setup`, `channels`, `categories`, `status`, `stats`, `staff`, `report`, `diagnose` |
| `/review` | `pending`, `history`, `approve`, `reject`, `later`, `cancel` |
| `/warning` | `history`, `profile`, `issue`, `remove`, `appeal`, `config` |
| `/settings` | `inactivity`, `features`, `alerts`, `permissions`, `leave`, `logs` |
| `/dashboard` | Opens the interactive guild-isolated Server Management Dashboard (or Global Owner Command Center) |

### 2. Interactive Dashboards & Persistent Buttons
- **Global Owner Command Center (`src/dashboards/GlobalOwnerDashboard.ts`)**: 12 interactive sections (`Overview`, `Connected Guilds`, `Guild Inspector`, `Global Inbox`, `Pending Approvals`, `Bot Admins`, `Global Features`, `Global Analytics`, `Warning Governance`, `System Health`, `Database Backups`, `Global Audit Log`) gated exclusively to `1131248987173814336`.
- **Server Management Dashboard (`src/dashboards/ServerManagementDashboard.ts`)**: 15 guild-isolated sections (`Server Overview`, `Staff Roster`, `Active/At-Risk/Inactive Filters`, `Ticket Operations`, `Pending Reviews`, `Warning Ledger`, `Leave Management`, `Appeal Queue`, `Role Thresholds`, `Feature Toggles`, `Permissions & Reviewers`, `Alert Channels`, `Monitoring Coverage`, `Visual Reports & Exports`, `Audit Trail`) with select menus, pagination, modals, and instant actions.

### 3. Ticket Engine & Third-Party Bot Adapters
- Built-in generic Discord channel/thread ticket lifecycle tracker (`open`, `assigned`, `waiting_on_staff`, `waiting_on_user`, `escalated`, `resolved`, `closed`, `reopened`, `abandoned`) measuring first-response, average-response, and resolution SLAs.
- Modular `ITicketAdapter` registry (`src/tickets/`) supporting:
  - **Generic Channel/Category/Thread Engine** (`GenericTicketAdapter`)
  - **Ticket Tool** (`TicketToolAdapter`, Bot ID `557628352828014614`)
  - **Tickets v2** (`TicketsV2Adapter`, Bot ID `508391840525975553`)
  - **Custom Regex / Embed Pattern Adapter** (`CustomPatternTicketAdapter`)
- Includes `/ticket diagnose` to inspect permissions, channel visibility, intent flags, and adapter confidence without claiming hidden third-party bot state.

### 4. 17 Real Runtime Feature Toggles
Both Global Owner policies and per-guild settings control real runtime behavior across 17 switches:
`roster_sync`, `scheduled_scanning`, `manual_scanning`, `ticket_monitoring`, `ticket_integrations`, `activity_monitoring`, `inactivity_detection`, `inactivity_reports`, `approval_notifications`, `warning_delivery`, `daily_reports`, `weekly_reports`, `monthly_reports`, `analytics`, `chart_generation`, `animated_assets`, and `presence_monitoring`.

### 5. Branded Visuals, Animated Banners, Emojis & Exports
- Deep-purple & neon-cyan executive theme (`#7B2FBE`, `#211238`, `#A855F7`, `#22D3EE`, `#22C55E`, `#F59E0B`, `#EF4444`, `#64748B`).
- Centralized 17-key emoji manifest (`assets/emojis/emoji-manifest.json`) with clean Unicode fallbacks (zero fake snowflake IDs) and automated Discord Application Emoji uploader (`npm run upload:emojis`).
- 6 animated GIF banners + 6 static PNG fallbacks (`welcome`, `staff-scanning`, `ticket-monitoring`, `warning-approval`, `owner-dashboard`, `system-health`) generated deterministically in `assets/banners/`.
- Real database exports in **PNG** (`@resvg/resvg-js` + DejaVu fonts), **CSV**, and **PDF** (`pdfkit`) across `DAILY`, `WEEKLY`, `MONTHLY`, `CUSTOM`, `STAFF_INDIVIDUAL`, `SERVER_SUMMARY`, and `GLOBAL_OWNER_SUMMARY` scopes.

---

## Quick Start

### Prerequisites
- **Node.js** `>= 20.0.0` (Node 22 LTS recommended)
- Build tools (`gcc`, `g++`, `make`, `python3`) if compiling `better-sqlite3` from source

### Installation
```bash
# 1. Install dependencies
npm install

# 2. Generate animated GIF/PNG banners & emoji assets (already pre-generated in assets/)
npm run generate:assets

# 3. Non-destructive interactive setup (.env creation + persistent data directories + SQLite migrations)
npm run setup

# 4. Compile TypeScript production build
npm run build

# 5. Register Discord slash commands
npm run deploy:commands

# 6. Start the platform
npm start
```

> **Safety Note:** `npm run setup` never overwrites an existing `.env` file or an existing SQLite database, and `loadAppConfig()` rejects `/tmp` or `/var/tmp` paths in production so persistent data cannot be lost across host reboots.

---

## Operations & Documentation

| Guide | Path |
|---|---|
| First-Time Setup & Discord Portal Intents | [`docs/INSTALLATION.md`](docs/INSTALLATION.md) |
| Ubuntu VPS (`systemd`) & Pterodactyl Hosting | [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) |
| Atomic SQLite Backup & Disaster Recovery | [`docs/BACKUP_AND_RECOVERY.md`](docs/BACKUP_AND_RECOVERY.md) |
| Operational Diagnostics & Troubleshooting | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| Full Requirement-by-Requirement Audit | [`COMPLIANCE_AUDIT.md`](COMPLIANCE_AUDIT.md) |

### Useful CLI Scripts
```bash
npm test                  # Run full Vitest integration suite against real temporary SQLite files
npm run typecheck         # Strict TypeScript compiler check (tsc --noEmit)
npm run build             # Production build to dist/ + copy SQL migrations
npm run migrate           # Apply pending SQLite schema migrations
npm run backup            # Create & integrity-verify an atomic SQLite snapshot
npm run restore -- <file> # Safely restore SQLite DB (saves automatic pre-restore snapshot first)
npm run upload:emojis     # Upload custom emojis to Discord REST v10 & sync emoji-manifest.json
```

---

*⚡ Made by Tanveer | Discord: tanveer5637*
