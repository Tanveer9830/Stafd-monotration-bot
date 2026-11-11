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

## 7. Dashboard shows "Discord OAuth2 is not configured"
- Set `DISCORD_CLIENT_SECRET` and `OAUTH2_REDIRECT_URI` in `.env`, then restart the bot.
- Verify the same redirect URL is listed under Discord Developer Portal → OAuth2 → Redirects.
- If `WEB_BASE_URL` is HTTPS, `COOKIE_SECURE=auto` will set Secure cookies; a plain HTTP visit cannot keep the session.

## 8. Dashboard sign-in returns `invalid_state` or `access_denied`
- OAuth states expire after 10 minutes and are single-use. Return to the dashboard and sign in again.
- Check the server clock; large clock drift invalidates state TTL comparisons.
- Do not open `/auth/callback` directly; start from `/auth/login`.

## 9. Dashboard is reachable but every action returns 403
- A stale CSRF token or session is the usual cause. Reload the page and sign in again.
- Verify `WEB_BASE_URL` matches the public origin exactly. Origin checks intentionally reject mismatched hosts.
- If behind a proxy, make sure it preserves the original `Host` header and does not rewrite `/api/` requests.

## 10. Live updates disconnect every 25 seconds
- The SSE endpoint revalidates the session on each heartbeat. A revoked or expired session is closed intentionally.
- Nginx must disable proxy buffering for `/api/events` and allow long read timeouts.

## 11. Website role changes do not take effect
- Role resolution has no cache; changes apply on the next request.
- Revoke the user's website session if you also want to force a new sign-in.
- Global Administrators only receive scopes explicitly granted in **Global Administrators**; they do not inherit server data.

## 12. Staff role scan from the website reports PARTIAL coverage
- Website scans use the bot member cache. Run `/staff sync` or `/staff scan` in Discord for a full member fetch.
- Enable Server Members intent and verify `ENABLE_GUILD_MEMBERS_INTENT=true`.

## 13. Scheduled scans stop after enabling global pause
- Global pause (`monitoring_paused_globally`) is an emergency stop for scheduled scans. Set it back to `false` on System Health.
- Per-server pause is separate: `/monitor pause` toggles that guild's `scheduled_scanning` feature.
