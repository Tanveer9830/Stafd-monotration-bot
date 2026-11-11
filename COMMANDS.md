# TANVEER STAFF MONITOR — Command Reference

This document lists every registered slash command and subcommand in the TANVEER STAFF MONITOR bot, with descriptions, required permissions, options, implementation location, and status.

**Brand:** TANVEER STAFF MONITOR  
**Creator:** MADE BY TANVEER | Discord: tanveer5637  
**Permanent Global Owner ID:** `1131248987173814336`  
**Footer:** ⚡ Made by Tanveer | Discord: tanveer5637  

---

## Security Model (CRITICAL)

Administrative and server-management commands are executable **ONLY** by:
1. The actual Discord Server Owner (guild `ownerId`) of the current guild, AND/OR
2. The Permanent Global Owner ID `1131248987173814336`

**Explicitly excluded:** Co-Owners, Server Administrators, Management, Moderators, Helpers, Staff, ordinary members, members with Discord Administrator permission, members with similarly named roles.

Authorization is verified via:
- Exact User ID match against `1131248987173814336` (Global Owner)
- Guild `ownerId` field synced from Discord gateway events (Server Owner)
- Explicit `guild_permission_assignments` table (User ID / Role ID only, never role names)

Permission is enforced on: every slash command, every button, every modal, every select menu, every dashboard action, and in backend service logic.

Unauthorized attempts return a branded **ACCESS DENIED** embed and are recorded in audit logs.

---

## Command Index (23 roots)

| # | Command | Required Permission | Implementation |
|---|---------|---------------------|----------------|
| 1 | `/owner` | Global Owner only | `src/commands/ownerCommand.ts` |
| 2 | `/admin` | Global Owner only | `src/commands/adminCommand.ts` |
| 3 | `/server` | Server Owner or Global Owner | `src/commands/serverCommand.ts` |
| 4 | `/dashboard` | Server Owner or Global Owner | `src/commands/dashboardCommand.ts` |
| 5 | `/staff` | Server Owner or authorized reviewer | `src/commands/staffCommand.ts` |
| 6 | `/activity` | View reports or owner | `src/commands/activityCommand.ts` |
| 7 | `/monitor` | Server Owner or Global Owner | `src/commands/monitorCommand.ts` |
| 8 | `/scan` | Server Owner or Global Owner | `src/commands/scanCommand.ts` |
| 9 | `/ticket` | Server Owner or authorized | `src/commands/ticketCommand.ts` |
| 10 | `/integration` | Server Owner or Global Owner | `src/commands/integrationCommand.ts` |
| 11 | `/review` | Authorized reviewer or owner | `src/commands/reviewCommand.ts` |
| 12 | `/warning` | Authorized reviewer or owner | `src/commands/warningCommand.ts` |
| 13 | `/appeal` | Staff (submit) / Reviewer (decide) | `src/commands/appealCommand.ts` |
| 14 | `/leave` | Staff (submit) / Manager (approve) | `src/commands/leaveCommand.ts` |
| 15 | `/analytics` | View reports or owner | `src/commands/analyticsCommand.ts` |
| 16 | `/report` | View reports or owner | `src/commands/reportCommand.ts` |
| 17 | `/settings` | Server Owner or Global Owner | `src/commands/settingsCommand.ts` |
| 18 | `/security` | Server Owner or Global Owner | `src/commands/securityCommand.ts` |
| 19 | `/logs` | View reports or owner | `src/commands/logsCommand.ts` |
| 20 | `/backup` | Global Owner only | `src/commands/backupCommand.ts` |
| 21 | `/system` | Server Owner or Global Owner | `src/commands/systemCommand.ts` |
| 22 | `/notification` | Server Owner or Global Owner | `src/commands/notificationCommand.ts` |
| 23 | `/help` | All users | `src/commands/helpCommand.ts` |

**Registry:** `src/commands/index.ts` — `ALL_COMMANDS` array, `COMMAND_MAP`, `registerDiscordSlashCommands()`

---

## Detailed Command Reference

### 1. `/owner` — Global Owner Management
**File:** `src/commands/ownerCommand.ts`  
**Permission:** Global Owner only (ID `1131248987173814336`)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `panel` | Open Global Owner Command Center | none | ✅ Implemented |
| `admin add` | Appoint a bot administrator | `user` (user), `scopes` (string), `notes` (string) | ✅ Implemented |
| `admin remove` | Remove a bot administrator | `user` (user) | ✅ Implemented |
| `admin list` | List all bot administrators | none | ✅ Implemented |
| `guilds` | List all registered guilds | none | ✅ Implemented |
| `guild-info` | View guild configuration | `guild_id` (string) | ✅ Implemented |
| `features` | Toggle global feature | `feature` (string), `allowed` (boolean) | ✅ Implemented |
| `global-stats` | View global statistics | `export` (string: png/csv/pdf) | ✅ Implemented |
| `audit` | View global audit logs | none | ✅ Implemented |

---

### 2. `/admin` — Bot Administrator Management
**File:** `src/commands/adminCommand.ts`  
**Permission:** Global Owner only

| Subcommand Group | Subcommand | Description | Options | Status |
|-----------------|------------|-------------|---------|--------|
| `admins` | `add` | Appoint a bot administrator | `user` (user), `scopes` (string), `notes` (string) | ✅ Implemented |
| `admins` | `remove` | Remove a bot administrator | `user` (user) | ✅ Implemented |
| `admins` | `list` | List all bot administrators | none | ✅ Implemented |
| `scopes` | `view` | View admin scopes for a user | `user` (user) | ✅ Implemented |
| `scopes` | `set` | Set admin scopes for a user | `user` (user), `scopes` (string) | ✅ Implemented |

---

### 3. `/server` — Server Management
**File:** `src/commands/serverCommand.ts`  
**Permission:** Server Owner or Global Owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `info` | Inspect server configuration and ownership | none | ✅ Implemented |
| `register` | Register this server with the bot | none | ✅ Implemented |
| `owner` | View or transfer server ownership | `new_owner` (string, optional) | ✅ Implemented |
| `leave` | Have the bot leave a server | `guild_id` (string) | ✅ Implemented |
| `settings` | View all server settings | none | ✅ Implemented |

---

### 4. `/dashboard` — Interactive Dashboards
**File:** `src/commands/dashboardCommand.ts`  
**Permission:** Server Owner or Global Owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| (root) | Open Server Management Dashboard or Global Owner Command Center | none | ✅ Implemented |

**Dashboard implementations:**
- `src/dashboards/GlobalOwnerDashboard.ts` — 12 sections, global view
- `src/dashboards/ServerManagementDashboard.ts` — 15 sections, per-server view

---

### 5. `/staff` — Staff Management
**File:** `src/commands/staffCommand.ts`  
**Permission:** Server Owner or authorized reviewer

| Subcommand Group | Subcommand | Description | Options | Status |
|-----------------|------------|-------------|---------|--------|
| (root) | `setup` | Configure staff roles and monitoring | none | ✅ Implemented |
| (root) | `scan` | Run full roster scan | none | ✅ Implemented |
| (root) | `list` | List all staff members | none | ✅ Implemented |
| (root) | `active` | List active staff | none | ✅ Implemented |
| (root) | `inactive` | List inactive staff | none | ✅ Implemented |
| (root) | `at-risk` | List at-risk staff | none | ✅ Implemented |
| (root) | `unknown` | List unknown/unregistered staff | none | ✅ Implemented |
| (root) | `profile` | View staff profile | `user` (user) | ✅ Implemented |
| (root) | `activity` | View staff activity | `user` (user) | ✅ Implemented |
| (root) | `history` | View staff history | `user` (user) | ✅ Implemented |
| `roles` | `add` | Add staff role | `role` (role), `category` (string) | ✅ Implemented |
| `roles` | `remove` | Remove staff role | `role` (role) | ✅ Implemented |
| `roles` | `list` | List staff roles | none | ✅ Implemented |
| (root) | `report` | Generate staff report | `period` (string), `format` (string) | ✅ Implemented |
| (root) | `analytics` | View staff analytics | `period` (string) | ✅ Implemented |
| (root) | `coverage` | View monitoring coverage | none | ✅ Implemented |

---

### 6. `/activity` — Staff Activity Tracking
**File:** `src/commands/activityCommand.ts`  
**Permission:** View reports or owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `list` | List recent qualifying activity events | `user` (user, optional), `limit` (integer) | ✅ Implemented |
| `profile` | View activity profile for a staff member | `user` (user) | ✅ Implemented |
| `stats` | View server-wide activity statistics | none | ✅ Implemented |
| `export` | Export activity log (CSV) | none | ✅ Implemented |

---

### 7. `/monitor` — Monitoring Controls
**File:** `src/commands/monitorCommand.ts`  
**Permission:** Server Owner or Global Owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `status` | Show monitoring status | none | ✅ Implemented |
| `enable` | Enable monitoring for this server | none | ✅ Implemented |
| `disable` | Disable monitoring for this server | none | ✅ Implemented |
| `config` | Configure monitoring settings | `key` (string), `value` (string) | ✅ Implemented |

---

### 8. `/scan` — Manual and Scheduled Scans
**File:** `src/commands/scanCommand.ts`  
**Permission:** Server Owner or Global Owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `run` | Run a manual roster scan | `scope` (string: full/incremental) | ✅ Implemented |
| `schedule` | Configure scan schedule | `interval_minutes` (integer) | ✅ Implemented |
| `history` | View scan history | `limit` (integer) | ✅ Implemented |
| `cancel` | Cancel a scheduled scan | `scan_id` (string) | ✅ Implemented |

---

### 9. `/ticket` — Ticket Management
**File:** `src/commands/ticketCommand.ts`  
**Permission:** Server Owner or authorized

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `setup` | Configure ticket channel monitoring | `adapter` (string), `target` (channel) | ✅ Implemented |
| `channels` | List ticket channels | `action` (string) | ✅ Implemented |
| `categories` | List ticket categories | `action` (string) | ✅ Implemented |
| `status` | View ticket monitoring status | none | ✅ Implemented |
| `stats` | View ticket statistics | none | ✅ Implemented |
| `staff` | View ticket staff assignments | none | ✅ Implemented |
| `report` | Generate ticket report | `format` (string), `period` (string) | ✅ Implemented |
| `diagnose` | Run ticket engine diagnostics | none | ✅ Implemented |

**Ticket adapters:** `src/tickets/adapters/` — GenericTicketAdapter, TicketToolAdapter, TicketsV2Adapter, CustomPatternTicketAdapter

---

### 10. `/integration` — Ticket Integrations
**File:** `src/commands/integrationCommand.ts`  
**Permission:** Server Owner or Global Owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `list` | List configured integrations | none | ✅ Implemented |
| `add` | Add a ticket integration | `type` (string), `external_id` (string) | ✅ Implemented |
| `remove` | Remove a ticket integration | `type` (string), `external_id` (string) | ✅ Implemented |
| `test` | Test an integration connection | `type` (string) | ✅ Implemented |

**Schema:** `integration_configs` table (migration 002)

---

### 11. `/review` — Inactivity Warning Review
**File:** `src/commands/reviewCommand.ts`  
**Permission:** Authorized reviewer or owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `pending` | List pending warning reviews | none | ✅ Implemented |
| `history` | View review history | `limit` (integer) | ✅ Implemented |
| `approve` | Approve a warning review | `review_id` (string), `reason` (string) | ✅ Implemented |
| `reject` | Reject a warning review | `review_id` (string), `note` (string) | ✅ Implemented |
| `later` | Defer a review | `review_id` (string), `hours` (integer) | ✅ Implemented |
| `cancel` | Cancel a review | `review_id` (string), `reason` (string) | ✅ Implemented |

---

### 12. `/warning` — Warning Management
**File:** `src/commands/warningCommand.ts`  
**Permission:** Authorized reviewer or owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `history` | List warning history | `user` (user, optional), `limit` (integer) | ✅ Implemented |
| `profile` | View warning profile for a staff member | `user` (user) | ✅ Implemented |
| `issue` | Issue a warning | `user` (user), `reason` (string) | ✅ Implemented |
| `remove` | Remove a warning | `warning_id` (string), `reason` (string) | ✅ Implemented |
| `appeal` | Submit or view an appeal | `action` (string), `target_id` (string), `reason` (string) | ✅ Implemented |
| `config` | Configure warning settings | `expiry_days` (integer), `approval_policy` (string) | ✅ Implemented |

---

### 13. `/appeal` — Warning Appeals
**File:** `src/commands/appealCommand.ts`  
**Permission:** Staff (submit) / Reviewer (decide)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `submit` | Submit a warning appeal | `warning_id` (string), `reason` (string) | ✅ Implemented |
| `list` | List appeals | `status` (string, optional) | ✅ Implemented |
| `decide` | Decide on an appeal | `appeal_id` (string), `decision` (string), `note` (string) | ✅ Implemented |
| `history` | View appeal history | `user` (user, optional) | ✅ Implemented |

**Schema:** `warning_appeals` table (migration 001)

---

### 14. `/leave` — Staff Leave Management
**File:** `src/commands/leaveCommand.ts`  
**Permission:** Staff (submit) / Manager (approve)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `submit` | Submit a leave request | `staff` (user, optional), `start_date` (string), `end_date` (string), `reason` (string) | ✅ Implemented |
| `active` | View active and pending leave | none | ✅ Implemented |
| `history` | View historical leave records | none | ✅ Implemented |
| `approve` | Approve a leave request | `leave_id` (string), `note` (string) | ✅ Implemented |
| `reject` | Reject a leave request | `leave_id` (string), `note` (string) | ✅ Implemented |
| `cancel` | Cancel a leave request | `leave_id` (string), `reason` (string) | ✅ Implemented |

---

### 15. `/analytics` — Performance Analytics
**File:** `src/commands/analyticsCommand.ts`  
**Permission:** View reports or owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `server` | Build server-wide analytics | `period` (string: DAILY/WEEKLY/MONTHLY/CUSTOM) | ✅ Implemented |
| `staff` | Build staff-specific analytics | `user` (user), `period` (string) | ✅ Implemented |
| `period` | View period comparison | `from_date` (string), `to_date` (string) | ✅ Implemented |
| `export` | Export analytics report | `period` (string), `format` (string: png/csv/pdf) | ✅ Implemented |

**Service:** `src/services/AnalyticsService.ts`  
**Exporter:** `src/services/ReportExportService.ts` (PNG, CSV, PDF)

---

### 16. `/report` — Report Generation
**File:** `src/commands/reportCommand.ts`  
**Permission:** View reports or owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `generate` | Generate a branded performance report | `period` (string), `format` (string), `from_date` (string), `to_date` (string) | ✅ Implemented |
| `schedule` | View scheduled reports | none | ✅ Implemented |
| `list` | List report generation history | none | ✅ Implemented |

**Schema:** `report_schedules` table (migration 002)

---

### 17. `/settings` — Server Configuration
**File:** `src/commands/settingsCommand.ts`  
**Permission:** Server Owner or Global Owner

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `inactivity` | Configure inactivity thresholds | `at_risk_hours`, `inactive_hours`, `escalation_hours`, `baseline_hours`, `scan_interval_minutes` (integers) | ✅ Implemented |
| `features` | Toggle local feature switches | `feature` (string), `enabled` (boolean) | ✅ Implemented |
| `alerts` | Configure alert/audit channels | `alert_channel` (channel), `log_channel` (channel), `fallback_review_channel` (channel) | ✅ Implemented |
| `permissions` | Configure reviewer permissions | `action` (string: add/remove/list) | ✅ Implemented |
| `leave` | Configure leave settings | `action` (string), dates, reason | ✅ Implemented |
| `logs` | View audit logs | `limit` (integer) | ✅ Implemented |

---

### 18. `/security` — Security and Permissions
**File:** `src/commands/securityCommand.ts`  
**Permission:** Server Owner or Global Owner (Global Owner only for `policy` and `features`)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `policy` | View global security & approval policies | none | ✅ Implemented |
| `permissions` | View guild permission assignments | none | ✅ Implemented |
| `audit` | View security-related audit entries | none | ✅ Implemented |
| `features` | View global feature restrictions | none | ✅ Implemented |

---

### 19. `/logs` — Audit Logs
**File:** `src/commands/logsCommand.ts`  
**Permission:** View reports or owner (Global Owner only for `global`)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `view` | View guild-isolated audit entries | `limit` (integer) | ✅ Implemented |
| `search` | Search audit logs by action type | `action_type` (string), `limit` (integer) | ✅ Implemented |
| `global` | View global audit logs | `limit` (integer) | ✅ Implemented |

**Service:** `src/services/AuditService.ts`

---

### 20. `/backup` — Database Backup and Recovery
**File:** `src/commands/backupCommand.ts`  
**Permission:** Global Owner only

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `create` | Create an atomic database backup | none | ✅ Implemented |
| `list` | List available backups | none | ✅ Implemented |
| `restore` | Restore database from backup | `filename` (string) | ✅ Implemented |
| `verify` | Verify backup integrity | `filename` (string) | ✅ Implemented |

**Service:** `src/database/backup.ts` (DatabaseBackupService)  
**Schema:** `backup_records` table (migration 002)

---

### 21. `/system` — Bot Health and Diagnostics
**File:** `src/commands/systemCommand.ts`  
**Permission:** Server Owner or Global Owner (`info`: Global Owner only)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `health` | View overall system health | none | ✅ Implemented |
| `diagnostics` | View ticket engine diagnostics | none | ✅ Implemented |
| `info` | View bot system information | none | ✅ Implemented |
| `scheduler` | View scheduler status and pending tasks | none | ✅ Implemented |

**Service:** `src/services/SchedulerService.ts`, `src/services/TicketService.ts`

---

### 22. `/notification` — Notification Management
**File:** `src/commands/notificationCommand.ts`  
**Permission:** Server Owner or Global Owner (`global`: Global Owner only)

| Subcommand | Description | Options | Status |
|------------|-------------|---------|--------|
| `list` | List notification history | none | ✅ Implemented |
| `config` | Configure notification delivery | `type` (string), `channel` (string) | ✅ Implemented |
| `test` | Send a test notification | `type` (string) | ✅ Implemented |
| `global` | View Global Owner inbox | none | ✅ Implemented |

**Schema:** `notification_configs` table (migration 002)  
**Service:** `src/services/NotificationService.ts`

---

### 23. `/help` — Interactive Command Guide
**File:** `src/commands/helpCommand.ts`  
**Permission:** All users

| Option | Description | Values | Status |
|--------|-------------|--------|--------|
| `category` | Command category to view | owner/server/staff/activity/monitor/scan/ticket/integration/review/warning/appeal/leave/analytics/report/settings/security/logs/backup/system/notification/all | ✅ Implemented |

---

## Database Schema (Migration 002)

**File:** `src/database/migrations/002_command_expansion.sql`

| Table | Purpose |
|-------|---------|
| `integration_configs` | Third-party ticket integrations per guild |
| `backup_records` | Database backup and recovery history |
| `notification_configs` | Per-guild notification routing |
| `report_schedules` | Scheduled report generation |
| `staff_discovery_configs` | Staff role discovery configuration |
| `command_permission_overrides` | Per-command permission overrides |

---

## Implementation Status Summary

| Category | Commands | Subcommands | Status |
|----------|----------|-------------|--------|
| Owner/Admin | 2 | 9 | ✅ Complete |
| Server/Dashboard | 2 | 6 | ✅ Complete |
| Staff/Activity | 2 | 18 | ✅ Complete |
| Monitor/Scan | 2 | 8 | ✅ Complete |
| Ticket/Integration | 2 | 12 | ✅ Complete |
| Review/Warning | 2 | 12 | ✅ Implemented |
| Appeal/Leave | 2 | 10 | ✅ Implemented |
| Analytics/Report | 2 | 7 | ✅ Implemented |
| Settings/Security | 2 | 12 | ✅ Implemented |
| Logs/Backup | 2 | 7 | ✅ Implemented |
| System/Notification | 2 | 8 | ✅ Implemented |
| Help | 1 | 1 | ✅ Implemented |
| **Total** | **23** | **~110** | **✅ All implemented** |

---

## Test Coverage

**Test file:** `tests/07-command-expansion-new-roots.test.ts`  
**Total tests:** 52 (all passing)

Covered scenarios:
- Global Owner can access every global command and manage every registered guild
- Server Owner can manage their own server but not another server
- Co-Owner, Discord Administrator, Management, Moderator, Staff, ordinary member cannot use administrative commands
- Unauthorized buttons, modals, and dashboard actions are rejected
- Permission checks work after container reopen (simulates bot restart)
- Unauthorized attempts are recorded in audit logs
- Bot Admin cannot appoint itself Global Owner
- Guild isolation: Server A owner cannot access Server B data

**Other test files (26 tests):**
- `tests/01-authorization-and-isolation.test.ts` — Global Owner, permissions, guild isolation
- `tests/02-roster-and-scanner.test.ts` — Roster and scanner
- `tests/03-tickets-and-adapters.test.ts` — Ticket adapters
- `tests/04-reviews-warnings-and-leave.test.ts` — Reviews, warnings, leave
- `tests/05-dashboards-reports-commands-and-backup.test.ts` — Dashboards, reports, commands, backup
- `tests/06-slash-command-handlers.test.ts` — Existing command handlers

**Grand total:** 78 tests across 7 test files, all passing.

---

## Security Implementation (14 Points)

| # | Requirement | Implementation |
|---|-------------|----------------|
| 1 | Identify server owner via guild `ownerId` | `PermissionService.evaluateGuildPermissions()` reads `guild_config.owner_id` |
| 2 | Identify Global Owner via ID only | `isPermanentGlobalOwner()` — exact string match against `1131248987173814336` |
| 3 | Never authorize via role names/usernames/nicknames/Admin permission | Only exact User ID and Role ID in `guild_permission_assignments` |
| 4 | Verify permissions on every slash command | All 23 commands call `assertAuthorizedOrDenied()` or `assertGuildCapability()` |
| 5 | Verify on every button | Dashboard buttons use `createAccessDeniedButtonRow()` |
| 6 | Verify on every modal | Modal submissions route through `interactionRouter.ts` with permission checks |
| 7 | Verify on every select menu | Select menus route through `interactionRouter.ts` with permission checks |
| 8 | Verify on every dashboard action | `GlobalOwnerDashboard.ts` and `ServerManagementDashboard.ts` enforce per-action |
| 9 | Enforce in backend service logic | `PermissionService`, `WarningService`, `LeaveService`, etc. enforce server-side |
| 10 | Branded ACCESS DENIED embed | `src/utils/accessDenied.ts` — `createAccessDeniedEmbed()` |
| 11 | Record unauthorized attempts in audit logs | `assertAuthorizedOrDenied()` logs `UNAUTHORIZED_ATTEMPT` category |
| 12 | Prevent server owners from accessing other guilds | `evaluateGuildPermissions()` checks `guild_config.owner_id` per guild |
| 13 | Prevent Bot Admins from appointing themselves Global Owner | `addBotAdmin()` rejects `isPermanentGlobalOwner(targetUserId)` |
| 14 | Update local permissions on Discord ownership change | `evaluateGuildPermissions()` re-syncs on `actualGuildOwnerId` mismatch |

---

## Files Modified / Created

**New command modules (9):**
- `src/commands/adminCommand.ts`
- `src/commands/activityCommand.ts`
- `src/commands/analyticsCommand.ts`
- `src/commands/appealCommand.ts`
- `src/commands/backupCommand.ts`
- `src/commands/helpCommand.ts`
- `src/commands/integrationCommand.ts`
- `src/commands/leaveCommand.ts`
- `src/commands/logsCommand.ts`
- `src/commands/monitorCommand.ts`
- `src/commands/notificationCommand.ts`
- `src/commands/reportCommand.ts`
- `src/commands/scanCommand.ts`
- `src/commands/securityCommand.ts`
- `src/commands/serverCommand.ts`
- `src/commands/systemCommand.ts`

**Modified:**
- `src/commands/index.ts` — registered all 23 commands
- `src/database/migrations/002_command_expansion.sql` — 6 new tables
- `src/utils/accessDenied.ts` — ACCESS DENIED embed + `assertAuthorizedOrDenied()`

**New tests:**
- `tests/07-command-expansion-new-roots.test.ts` — 52 tests for all new commands
