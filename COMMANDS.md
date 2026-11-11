# TANVEER STAFF MONITOR — Command Reference

**Brand:** TANVEER STAFF MONITOR
**Creator:** ⚡ Made by Tanveer | Discord: tanveer5637
**Permanent Global Owner:** `1131248987173814336` (immutable, exact ID match only)
**Registered operations:** **exactly 100** across **18 slash-command roots**, enforced by `tests/08-command-registry.test.ts`.

> There are no hidden aliases, extra roots, or undocumented operations. Running `npm test` verifies the 100-operation count, per-root distribution, handler presence, and valid Discord option lengths.

---

## Access model

| Actor | How it is verified | Default reach |
|---|---|---|
| **Global Owner** | Exact ID `1131248987173814336` (never username, nickname, role, guild ownership or Administrator permission) | Global + every server |
| **Global Administrator** | Explicit `/owner admins add` appointment with `WEB_ROLE_ASSIGNMENTS` scopes | Only the explicitly granted platform scopes; **no** automatic cross-server data |
| **Server Owner** | Live Discord `guild.ownerId`, with stored owner as documented fallback when the bot is offline | Own guild only |
| **Server Co-Owner** | `SERVER_CO_OWNER` role assigned in Discord or the website Access & Roles panel | Explicit local scopes |
| **Server Admin** | `SERVER_ADMIN` role / website assignment | Explicit local scopes |
| **Viewer** | `SERVER_VIEWER` / `STAFF_VIEWER` website role | Read-only scopes granted |
| **Staff** | Active `staff_profiles` row discovered from configured staff roles | Own staff record when granted `STAFF_SELF_VIEW` |

Every command resolves access server-side through `AuthzService`. A member with the Discord **Administrator** permission is not a Server Owner and gains nothing automatically. Unauthorized attempts are audited as `UNAUTHORIZED_ATTEMPT`.

### Access by root

| Root | Minimum access |
|---|---|
| `/owner` | Global Owner only (Global Administrator may use only explicitly permitted read operations where the handler checks scopes) |
| `/admin`, `/server`, `/settings`, `/integration` | Verified Server Owner, Global Owner, or an explicitly scoped website role |
| `/staff`, `/activity`, `/scan`, `/review`, `/warning`, `/appeal`, `/leave`, `/analytics`, `/report`, `/ticket` | Server Owner / scoped manager; staff self-service operations allow the acting staff member |
| `/monitor`, `/system` | Local manage scope or Global Owner; `/system diagnostics` requires `GLOBAL_SYSTEM` |
| `/help` | Any user; shows only commands relevant to the caller |

---

## Operations

Each option marked `*` is required. Options are validated by Discord and again on the server.


### /owner (10 operations)

| Operation | Description | Options |
|---|---|---|
| `/owner panel` | Open the Global Owner command center | — |
| `/owner admins add` | Appoint a Global Administrator with explicit scopes (Global Owner only) | `user`*, `scopes`, `notes` |
| `/owner admins remove` | Revoke a Global Administrator (Global Owner only) | `user`* |
| `/owner admins list` | List appointed Global Administrators and their scopes | — |
| `/owner guilds` | List every registered Discord server | — |
| `/owner guild-info` | Inspect one registered server in detail | `guild_id`* |
| `/owner global-stats` | View cross-server platform analytics | `export` |
| `/owner audit` | Inspect platform and per-server audit logs | `guild_id`, `limit` |
| `/owner features` | Inspect or change global feature restrictions | `feature`, `allowed` |
| `/owner backup` | List or create verified database backups | `action`*, `label` |

### /admin (5 operations)

| Operation | Description | Options |
|---|---|---|
| `/admin add` | Assign SERVER_ADMIN website access to a member (server owner / Global Owner) | `user`*, `permissions`, `expires_days` |
| `/admin remove` | Revoke a member’s Server Administrator access | `user`* |
| `/admin list` | List server administrators, co-owners and viewers with scoped access | — |
| `/admin permissions` | Show the access permission matrix and assignable scopes | — |
| `/admin audit` | View local role and permission audit history | `limit` |

### /server (5 operations)

| Operation | Description | Options |
|---|---|---|
| `/server setup` | Configure alert, log and fallback channels for this server | `alert_channel`, `log_channel`, `fallback_channel`, `support_channels` |
| `/server info` | Show server configuration and ownership information | — |
| `/server status` | Show live monitoring, ticket and scheduler status | — |
| `/server features` | List or toggle server feature switches | `feature`, `enabled` |
| `/server diagnostics` | Run ticket permissions, intent and database diagnostics | — |

### /staff (14 operations)

| Operation | Description | Options |
|---|---|---|
| `/staff setup` | Show staff monitoring setup status and next steps | — |
| `/staff add` | Discover staff automatically from one or more Discord roles | `category` |
| `/staff remove` | Remove a member from the monitored staff roster (history is preserved) | `user`* |
| `/staff sync` | Synchronize the complete Discord member roster with configured staff roles | — |
| `/staff scan` | Run a manual staff monitoring scan with configured thresholds | — |
| `/staff list` | List monitored staff and their live monitoring status | `status` |
| `/staff profile` | View a complete staff profile | `user`* |
| `/staff activity` | View a staff member’s latest observable activity events | `user`*, `limit` |
| `/staff history` | View a staff member’s role and monitoring history | `user`* |
| `/staff roles add` | Register a staff role by ID (bypasses the interactive selector) | `role`*, `category`* |
| `/staff roles remove` | Remove a configured staff role (profiles are preserved) | `role`* |
| `/staff roles list` | List configured staff roles with role IDs and categories | — |
| `/staff roles scan` | Audit configured staff roles against live Discord roles and members | — |
| `/staff report` | Export a staff analytics report (PNG, CSV or PDF) | `format`*, `period` |

### /activity (3 operations)

| Operation | Description | Options |
|---|---|---|
| `/activity overview` | Show live staff activity health and status distribution | — |
| `/activity timeline` | Show the live activity timeline across staff or one member | `user`, `limit` |
| `/activity response-times` | Show average response and resolution speeds across staff | — |

### /ticket (18 operations)

| Operation | Description | Options |
|---|---|---|
| `/ticket setup` | Configure a ticket category or channel for monitoring | `target`*, `adapter` |
| `/ticket channels` | List, add or remove monitored ticket channels | `action`*, `channel`, `adapter` |
| `/ticket categories` | List, add or remove monitored ticket categories | `action`*, `category`, `adapter` |
| `/ticket search` | Search real tickets by ticket number, channel ID or ticket ID | `query`*, `limit` |
| `/ticket view` | Open a ticket with captured conversation and event timeline | `ticket`* |
| `/ticket status` | Show the live ticket queue status | — |
| `/ticket claim` | Manually claim a ticket (cancels any pending automatic claim) | `ticket`* |
| `/ticket unclaim` | Release a ticket assignment | `ticket`* |
| `/ticket assign` | Assign a ticket to a staff member | `ticket`*, `staff`* |
| `/ticket reassign` | Reassign a ticket from its current staff member to another | `ticket`*, `staff`* |
| `/ticket staff` | Show ticket workload and speed for one staff member or the team | `user` |
| `/ticket history` | Show recent ticket lifecycle events across the server | `limit` |
| `/ticket timeline` | Show the chronological event timeline for one ticket | `ticket`* |
| `/ticket stats` | Show server ticket statistics | — |
| `/ticket response-times` | Show first-response time statistics per staff member | — |
| `/ticket resolution-times` | Show resolution time statistics per staff member | — |
| `/ticket reopen` | Reopen a resolved or closed ticket | `ticket`* |
| `/ticket close` | Close a ticket | `ticket`*, `reason` |

### /monitor (5 operations)

| Operation | Description | Options |
|---|---|---|
| `/monitor status` | Show monitoring pause state and scheduler health | — |
| `/monitor start` | Start monitoring: enable scanning and initialize schedules | — |
| `/monitor pause` | Pause monitoring for this server | — |
| `/monitor resume` | Resume monitoring for this server | — |
| `/monitor thresholds` | View or update inactivity thresholds (defaults 24h / 48h / 72h) | `at_risk_hours`, `inactive_hours`, `escalation_hours`, `scan_interval_minutes` |

### /scan (4 operations)

| Operation | Description | Options |
|---|---|---|
| `/scan now` | Run a complete monitoring scan now (roster + tickets + health) | — |
| `/scan staff` | Rescan the staff roster and monitoring status | — |
| `/scan tickets` | Scan ticket coverage, permissions and claim state | — |
| `/scan history` | Show recorded scan history for this server | `limit` |

### /review (5 operations)

| Operation | Description | Options |
|---|---|---|
| `/review pending` | List pending inactivity warning reviews | — |
| `/review approve` | Approve a review (runs live safety rechecks before any warning) | `review_id`*, `reason`, `note` |
| `/review reject` | Reject an inactivity review (no warning is issued) | `review_id`*, `note` |
| `/review later` | Defer a review for later inspection | `review_id`*, `hours`, `note` |
| `/review cancel` | Cancel an open review with a mandatory reason | `review_id`*, `reason`* |

### /warning (4 operations)

| Operation | Description | Options |
|---|---|---|
| `/warning issue` | Issue an authorized staff warning (delivered by DM when possible) | `user`*, `reason`*, `note`, `level` |
| `/warning history` | View warning history for the server or one staff member | `user`, `limit` |
| `/warning profile` | Show warning progression and appeal status for a staff member | `user`* |
| `/warning remove` | Remove an active warning (mandatory audit reason) | `warning_id`*, `reason`* |

### /appeal (4 operations)

| Operation | Description | Options |
|---|---|---|
| `/appeal submit` | Submit an appeal for one of your own warnings | `warning_id`*, `reason`* |
| `/appeal list` | List appeals by status | `status` |
| `/appeal approve` | Approve an appeal and overturn the warning | `appeal_id`*, `note`* |
| `/appeal reject` | Reject an appeal | `appeal_id`*, `note`* |

### /leave (5 operations)

| Operation | Description | Options |
|---|---|---|
| `/leave request` | Request approved leave (leave pauses inactivity calculations) | `start_date`*, `end_date`*, `reason`*, `staff` |
| `/leave approve` | Approve a pending leave request | `leave_id`*, `note` |
| `/leave reject` | Reject a pending leave request | `leave_id`*, `reason`* |
| `/leave active` | List currently active and upcoming approved leave | — |
| `/leave history` | Show leave history for the server or one member | `user`, `limit` |

### /analytics (5 operations)

| Operation | Description | Options |
|---|---|---|
| `/analytics overview` | Show server analytics overview | `period` |
| `/analytics staff` | Show fair staff performance analytics | `period` |
| `/analytics tickets` | Show ticket volume, response and resolution analytics | — |
| `/analytics workload` | Show workload distribution across active staff | — |
| `/analytics trends` | Show daily monitoring and ticket trends | `days` |

### /report (4 operations)

| Operation | Description | Options |
|---|---|---|
| `/report daily` | Generate today’s analytics report | — |
| `/report weekly` | Generate a weekly analytics report | — |
| `/report custom` | Generate a report for a custom date range | `from`*, `to`* |
| `/report export` | Export a branded report file | `format`*, `period` |

### /integration (3 operations)

| Operation | Description | Options |
|---|---|---|
| `/integration list` | List configured ticket integrations and adapter capabilities | — |
| `/integration setup` | Configure a per-server ticket integration record | `type`*, `name`, `config` |
| `/integration test` | Test ticket integration observability and channel permissions | — |

### /settings (3 operations)

| Operation | Description | Options |
|---|---|---|
| `/settings inactivity` | View or update inactivity thresholds | `at_risk_hours`, `inactive_hours`, `escalation_hours`, `observation_hours` |
| `/settings alerts` | Configure alert, log and DM fallback channels | `alert_channel`, `log_channel`, `fallback_channel`, `feature`, `enabled` |
| `/settings permissions` | View effective permissions and the access matrix | — |

### /system (2 operations)

| Operation | Description | Options |
|---|---|---|
| `/system status` | Show platform or server health status | — |
| `/system diagnostics` | Show deep system diagnostics (Global Owner / granted global scope) | — |

### /help (1 operations)

| Operation | Description | Options |
|---|---|---|
| `/help help` | Show the approved command reference and permissions | — |

---

## Common option vocabulary

| Option | Meaning |
|---|---|
| `user` | Discord user mention/ID resolved by Discord |
| `role` | Discord role mention/ID |
| `channel` / `category` | Discord channel ID |
| `staff` | Registered staff user ID |
| `ticket` | Internal ticket ID or ticket number |
| `reason` | Human-readable reason (stored in the audit log and ticket/warning record) |
| `limit` | Result limit, clamped by the server |
| `export` | Produce a CSV/PNG/PDF report attachment where the operation supports it |

## Website equivalents

The website (see `docs/WEBSITE_DASHBOARD.md`) exposes the same data through HTTP APIs with identical authorization checks. Website roles and scopes are documented in `docs/ACCESS_ROLES.md`. Bot commands and website actions share the same underlying services, so records created in one surface appear immediately in the other.

## Verification commands

```bash
npm run typecheck   # zero TypeScript errors
npm test            # command registry + authorization + roster + tickets + website tests
npm run build       # compiles and copies dashboard assets into dist/public
```
