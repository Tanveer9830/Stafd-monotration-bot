# TANVEER STAFF MONITOR — TROUBLESHOOTING GUIDE

## 1. Slash Commands Not Appearing in Discord
- Global Discord slash commands can take up to 15–60 minutes to propagate globally on first registration.
- For instant testing on a specific server, set `DISCORD_DEV_GUILD_ID=<your_server_id>` in `.env` and run `npm run deploy:commands`.
- Verify the bot was invited with **both** `bot` and `applications.commands` OAuth2 scopes.

## 2. Staff Roster Shows 0 Members
- Ensure you configured at least one staff role via `/staff roles add role:@Staff category:Staff`.
- Verify **Server Members Intent** (`GuildMembers`) is enabled in the Discord Developer Portal → Bot tab and `ENABLE_GUILD_MEMBERS_INTENT=true` in `.env`.
- Run `/staff scan` to synchronize and scan immediately.

## 3. Staff Members Show `⚪ UNKNOWN` or `🟠 INSUFFICIENT WORKLOAD`
- `⚪ UNKNOWN`: Ticket/support channels haven't been configured yet (`/ticket setup` or `/ticket categories`) OR monitoring coverage is `PARTIAL` (the bot is missing `ViewChannel` or `ReadMessageHistory` in one or more configured channels). Run `/ticket diagnose` or `/staff coverage` to see exact missing permissions.
- `🟠 INSUFFICIENT WORKLOAD`: By design, staff are **never** marked inactive when 0 unassigned/open tickets existed during their idle window.

## 4. Warning / Review DM Delivery Failed
- Users who disable "Allow direct messages from server members" in Discord privacy settings reject bot DMs.
- `TANVEER STAFF MONITOR` automatically:
  1. Preserves the warning or review record in SQLite (`dm_delivered = 0`, `dm_error` recorded).
  2. Retains Global Owner (`1131248987173814336`) notifications in the persistent **Global Inbox** (`/owner panel` → `6. Warning Reviews & Inbox`).
  3. Sends a fallback alert to your configured `fallback_review_channel` / `alert_channel` (`/settings alerts`).

## 5. PNG Chart Text Missing or Unstyled on Minimal Linux Containers
- Install `DejaVu Sans` fonts: `apt-get update && apt-get install -y fonts-dejavu-core`.

## 6. Third-Party Ticket Bots (Ticket Tool / Tickets v2)
- Run `/ticket diagnose` to verify adapter health.
- Ensure the category where Ticket Tool (`557628352828014614`) or Tickets v2 (`508391840525975553`) creates ticket channels/threads is registered via `/ticket setup target:#tickets-category adapter:ticket-tool` and that `TANVEER STAFF MONITOR` has `ViewChannel` + `ReadMessageHistory` on that category.
