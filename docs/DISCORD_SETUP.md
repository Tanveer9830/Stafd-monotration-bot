# TANVEER STAFF MONITOR — Discord Setup

This guide covers the Discord application, intents, invite permissions, OAuth2 redirects and initial in-server configuration.

---

## 1. Create the application

1. Open <https://discord.com/developers/applications> → **New Application**.
2. Name it **TANVEER STAFF MONITOR**.
3. Copy the **Application ID** → `DISCORD_CLIENT_ID`.
4. Open **Bot** → **Reset Token** → copy once → `DISCORD_TOKEN`. Never commit or paste the token into chat.

---

## 2. Privileged intents

| Intent | Recommended | Why |
|---|---|---|
| **Server Members** (`GuildMembers`) | **ON** | Complete staff discovery, role changes, member leave, NEW STAFF detection |
| **Presence** (`GuildPresences`) | **OFF** (optional) | Online status is not proof of staff work |
| **Message Content** (`MessageContent`) | **ON only if** you need plain-text ticket transcripts | Without it, capture still records metadata/embeds but shows “content unavailable” |

Enable the matching intents in the portal and in `.env`:

```env
ENABLE_GUILD_MEMBERS_INTENT=true
ENABLE_PRESENCE_INTENT=false
ENABLE_MESSAGE_CONTENT_INTENT=false
```

The bot documents permission limits instead of pretending to have data it cannot read. Partial coverage is surfaced in scans and diagnostics.

---

## 3. Invite the bot

Use **OAuth2 → URL Generator**:

- Scopes: `bot`, `applications.commands`
- Permissions:
  - View Channels
  - Send Messages
  - Send Messages in Threads
  - Embed Links
  - Attach Files
  - Read Message History
  - Use External Emojis
  - View Audit Log (recommended for moderation evidence)
  - Manage Channels (only if the bot should create/archive ticket channels)

Invite URL shape:

```text
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=PERMISSIONS&scope=bot%20applications.commands
```

The bot must be invited to each server it should monitor. A server is registered when the bot joins or when `/server setup` runs.

---

## 4. Dashboard OAuth2

1. **OAuth2 → General** → copy **Client Secret** → `DISCORD_CLIENT_SECRET`.
2. **OAuth2 → Redirects** → add:
   - `http://localhost:3000/auth/callback` for local testing
   - `https://staff.example.com/auth/callback` for production
3. Set:
   ```env
   WEB_BASE_URL=https://staff.example.com
   OAUTH2_REDIRECT_URI=https://staff.example.com/auth/callback
   COOKIE_SECURE=auto
   ```
4. Dashboard scopes requested: `identify`, `guilds`. No `email`, no bot token.

The redirect URL must match **exactly** (scheme, host, path, trailing slash). A mismatch produces Discord’s `redirect_uri` error and no session is created.

---

## 5. Server onboarding

Run these in Discord as the **actual Server Owner** or the **Permanent Global Owner**:

```text
/server setup
/staff add
```

- `/server setup` registers the guild and can configure alert/log/review channels.
- `/staff add` opens the paged role picker. Select every role that identifies staff; selections are preserved across pages. 100+ roles are supported with 20 per page and search.
- Confirm to scan. The report shows members scanned, staff discovered, newly registered, multi-role members, unmatched roles, errors and coverage level.
- Members are deduplicated by guild + user ID. Existing profiles and history are preserved.
- New members receive `NEW_STAFF` status during the observation baseline.

Then configure tickets and scanning:

```text
/ticket setup
/ticket channels
/scan now
/scan tickets
/settings inactivity
```

### Threshold order

Default thresholds are **24h at risk / 48h inactive / 72h escalation**. The bot validates `at_risk < inactive < escalation` and bounds values against the global config.

### Leave

```text
/leave request
/leave approve
```

Approved leave pauses inactivity scoring. Staff on leave are shown as `ON_LEAVE`, not inactive.

---

## 6. Command registration

- Global registration runs at startup when `AUTO_REGISTER_COMMANDS_ON_STARTUP=true`.
- For testing, set `DISCORD_DEV_GUILD_ID` to one server and run `npm run deploy:commands`; guild commands appear immediately.
- The registry registers exactly 18 roots and 100 operations. `/help` lists only the commands relevant to the caller.
- If registration fails, the bot logs the error and keeps running; retry with `npm run deploy:commands`.

---

## 7. Permissions the bot cannot bypass

Discord enforces:

- Channel overwrites: if the bot lacks **View Channel** or **Read Message History**, messages cannot be captured.
- Private channels and threads restrict the bot exactly like any member.
- Message Content is a privileged intent; without approval/enablement, plain message text is unavailable.
- Server Members is privileged; without it, only cached members are visible and scans report `PARTIAL`.
- The bot cannot read DMs it did not receive and cannot see deleted messages it never cached.
- Discord ownership is the only source of truth for Server Owner. Administrator permission does not make someone an owner.

These limits are reported by `/ticket diagnose`, `/staff coverage`, scan reports and the dashboard. They are never silently ignored.

---

## 8. Required initial data

| Data | How |
|---|---|
| Guild registration | Bot join or `/server setup` |
| Staff roles | `/staff add` or website Staff Roles page |
| Ticket channels | `/ticket setup` / `/ticket channels` |
| Alert and review channels | `/settings alerts` or server setup |
| Thresholds | `/settings inactivity` or website Settings |
| Global Administrators | `/owner admins add` (Global Owner only) |
| Website roles | Access & Roles panel or `/admin add` |
