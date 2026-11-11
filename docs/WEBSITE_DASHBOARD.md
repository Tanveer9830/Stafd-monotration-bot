# TANVEER STAFF MONITOR — Website Dashboard

The dashboard is served by the same Node.js process as the Discord bot. It uses Discord OAuth2 for identity, server-side sessions, CSRF protection, and Server-Sent Events (SSE) for live updates.

**Branding:** TANVEER STAFF MONITOR · ⚡ Made by Tanveer | Discord: tanveer5637

---

## 1. Start the dashboard

```bash
# .env
WEB_ENABLED=true
WEB_HOST=0.0.0.0
WEB_PORT=3000
WEB_BASE_URL=https://staff.example.com
DISCORD_CLIENT_ID=your_application_id
DISCORD_CLIENT_SECRET=your_oauth2_client_secret
OAUTH2_REDIRECT_URI=https://staff.example.com/auth/callback
COOKIE_SECURE=auto
```

Then:

```bash
npm run build
npm start
```

Open `WEB_BASE_URL`. When OAuth is not configured the sign-in page explains exactly which variables are missing; it never shows fake data.

### Discord Developer Portal

1. Open your application → **OAuth2**.
2. Add the exact redirect URL, e.g. `https://staff.example.com/auth/callback`.
3. Copy the **Client Secret** into `DISCORD_CLIENT_SECRET`.
4. Requested scopes are `identify` and `guilds`. No bot token is exposed to the browser.

---

## 2. Pages (exactly 26)

### Platform pages (8)

| # | Page | Route | Data source | Required access |
|---|---|---|---|---|
| 1 | Global Overview | `#/global/overview` | `/api/global/overview` | Global Owner, or explicit `GLOBAL_VIEW_ALL` |
| 2 | Global Servers | `#/global/guilds` | `/api/global/guilds` | Global Owner, or explicit `GLOBAL_VIEW_ALL` |
| 3 | Global Administrators | `#/global/admins` | `/api/global/admins` | `GLOBAL_MANAGE_ADMINS`; assignment is Global Owner only |
| 4 | Global Analytics | `#/global/analytics` | `/api/global/stats` | `GLOBAL_ANALYTICS` |
| 5 | Global Audit | `#/global/audit` | `/api/global/audit` | `GLOBAL_VIEW_AUDIT` |
| 6 | Sessions & Security | `#/global/sessions` | `/api/system/sessions`, `/api/system/security` | Self-service; all-session view requires `GLOBAL_SECURITY` |
| 7 | System Health | `#/global/health` | `/api/system/health` | `GLOBAL_SYSTEM` |
| 8 | Backups | `#/global/backups` | `/api/system/backups` | `GLOBAL_BACKUP` |

### Server pages (18)

| # | Page | Route | Data source | Required access |
|---|---|---|---|---|
| 9 | Server Overview | `#/g/:guildId/overview` | `/api/guilds/:id/overview` | `SERVER_VIEW_OVERVIEW` |
| 10 | Ticket Browser | `#/g/:guildId/tickets` | `/api/guilds/:id/tickets` | `SERVER_VIEW_TICKETS` |
| 11 | Ticket Detail | `#/g/:guildId/tickets/:ticketId` | `/api/guilds/:id/tickets/:ticketId` | `SERVER_VIEW_TICKETS`; transcript needs `SERVER_VIEW_TRANSCRIPTS` |
| 12 | Staff Monitor | `#/g/:guildId/staff` | `/api/guilds/:id/staff` | `SERVER_VIEW_STAFF` |
| 13 | Staff Profile | `#/g/:guildId/staff/:userId` · `#/g/:guildId/my-profile` | `/api/guilds/:id/staff/:userId` | `SERVER_VIEW_STAFF`, or self with `STAFF_SELF_VIEW` |
| 14 | Activity Timeline | `#/g/:guildId/activity` | `/api/guilds/:id/activity` | `SERVER_VIEW_STAFF` |
| 15 | Analytics | `#/g/:guildId/analytics` | `/api/guilds/:id/analytics` | `SERVER_VIEW_ANALYTICS` |
| 16 | Human Reviews | `#/g/:guildId/reviews` | `/api/guilds/:id/reviews` | `SERVER_MANAGE_REVIEWS` |
| 17 | Warnings | `#/g/:guildId/warnings` | `/api/guilds/:id/warnings` | view: `SERVER_VIEW_STAFF`; manage: `SERVER_MANAGE_WARNINGS` |
| 18 | Appeals | `#/g/:guildId/appeals` | `/api/guilds/:id/appeals` | `SERVER_MANAGE_APPEALS` |
| 19 | Leave | `#/g/:guildId/leave` | `/api/guilds/:id/leave` | self-service; manage: `SERVER_MANAGE_LEAVE` |
| 20 | Staff Roles & Discovery | `#/g/:guildId/staff-roles` | `/api/guilds/:id/staff-roles` | `SERVER_MANAGE_STAFF` |
| 21 | Access & Roles | `#/g/:guildId/access` | `/api/guilds/:id/access` | `SERVER_MANAGE_ROLES` |
| 22 | Settings | `#/g/:guildId/settings` | `/api/guilds/:id/settings` | read: `SERVER_VIEW_OVERVIEW`; write: `SERVER_MANAGE_SETTINGS` |
| 23 | Integrations | `#/g/:guildId/integrations` | `/api/guilds/:id/integrations` | view: `SERVER_VIEW_TICKETS`; manage: `SERVER_MANAGE_INTEGRATIONS` |
| 24 | Reports | `#/g/:guildId/reports` | `/api/guilds/:id/reports` | `SERVER_VIEW_ANALYTICS`; export: `SERVER_EXPORT_REPORTS` |
| 25 | Audit Log | `#/g/:guildId/audit` | `/api/guilds/:id/audit` | `SERVER_VIEW_AUDIT` |
| 26 | Notifications | `#/g/:guildId/notifications` | `/api/guilds/:id/notifications` | `SERVER_VIEW_OVERVIEW` |

The palette is Midnight `#211238`, Violet `#7B2FBE`, Bright purple `#A855F7`, Cyan `#22D3EE`, Green `#22C55E`, Amber `#F59E0B`, Red `#EF4444`, Slate `#64748B`. Layout is responsive down to phone widths; the sidebar becomes an overlay under 900 px.

---

## 3. Authentication and sessions

1. `GET /auth/login` creates a random, single-use OAuth state (10-minute TTL, stored in `website_oauth_states`) and redirects to Discord.
2. `GET /auth/callback` consumes the state, exchanges the code, fetches `/users/@me`, then creates a server-side session.
3. Only a SHA-256 digest of the 64-hex session token is stored in `website_sessions`. The raw token lives in an `HttpOnly`, `SameSite=Lax` cookie; `Secure` is automatic when `WEB_BASE_URL` is HTTPS.
4. Each request resolves the session, checks expiry/revocation, and throttles `last_seen_at` writes to once per five minutes.
5. `POST /auth/logout` verifies same-origin and the CSRF token, revokes the session, and clears the cookie.
6. Revoking any session takes effect on the next HTTP request and on the SSE heartbeat (25 seconds).

Session lifetime starts at 168 hours (`web_session_hours` in `system_settings`). No Discord access token is persisted; it is used only during the callback and discarded.

---

## 4. CSRF, origin and rate limiting

- Every `POST`, `PUT`, `PATCH`, and `DELETE` API request requires `X-CSRF-Token` equal to the session's CSRF token. The token is returned by `GET /api/me`.
- If an `Origin` header is present, it must match the request host or `WEB_BASE_URL`; otherwise the request is rejected with 403.
- Login attempts are limited to 20/minute per IP; authenticated mutations to 90/minute per user.
- Security headers include `X-Content-Type-Options`, `Referrer-Policy`, and a CSP. The CSP allows framing only for `'self'` and `*.e2b.app` (live preview environments), uses no inline scripts, and permits Discord CDN avatars.

---

## 5. Live updates (SSE)

`GET /api/events?guildId=:guildId`:

- Requires a valid session and either `SERVER_VIEW_OVERVIEW` or `SERVER_VIEW_TICKETS` for that guild.
- Emits `ready`, periodic `ping`, `auth_expired`, and `update` events.
- The server filters the in-process event bus by guild. Ticket/scan/auto-claim events trigger a debounced page refresh and a toast.
- Event payloads contain IDs and actions, never transcript text.
- Browser reconnect uses native `EventSource` retry plus an 8-second reconnect guard.

---

## 6. API reference (selected)

| Method & path | Purpose |
|---|---|
| `GET /api/public/config` | OAuth configuration status and branding (unauthenticated) |
| `GET /api/me` | Session user, CSRF token, global scopes, guild list, role assignments |
| `GET /api/global/overview` | Cross-server totals, alerts and health |
| `GET /api/global/guilds` | Registered guild inventory |
| `GET /api/global/admins` · `POST` · `DELETE /:id` | Global Administrator listing / owner-only assignment and revocation |
| `GET /api/global/stats` | Global analytics |
| `GET /api/global/audit` | Global audit log |
| `GET /api/system/health` | Database, migrations, scheduler locks, monitoring health, intents |
| `GET/POST /api/system/backups` | Verify/list or create an SQLite backup |
| `GET /api/system/sessions` · `DELETE /:id` | Session inventory / revocation |
| `GET /api/guilds/:id/overview` | Server snapshot and access summary |
| `GET /api/guilds/:id/tickets` | Filters: `status`, `claim`, `assignedTo`, `search`, `categoryId`, `from`, `to`, `page` |
| `GET /api/guilds/:id/tickets/search?q=` | Ticket-number search |
| `GET /api/guilds/:id/tickets/:ticketId` | Ticket facts, transcript (permission-gated), events, assignments, pending auto-claim |
| `POST /api/guilds/:id/tickets/:ticketId/{claim,unclaim,assign,reassign,resolve,close,reopen}` | Ticket actions with server-side scope checks |
| `GET /api/guilds/:id/staff` · `/staff/:userId` | Staff monitor / profile |
| `GET /api/guilds/:id/activity` | Raw activity evidence |
| `GET /api/guilds/:id/analytics` | Fairness-adjusted server report |
| `GET/POST /api/guilds/:id/reviews[/:id/{approve,confirm,reject,later,cancel,excuse}]` | Human review workflow |
| `GET/POST/DELETE /api/guilds/:id/warnings[/:id]` | Warning history, issue, remove |
| `GET/POST /api/guilds/:id/appeals[/submit|/:id/{approve,reject}]` | Appeals |
| `GET/POST /api/guilds/:id/leave[/request|/:id/{approve,reject}]` | Leave |
| `GET/POST/DELETE /api/guilds/:id/staff-roles[/:roleId]` · `POST /scan` | Role discovery and monitoring |
| `GET/POST/PATCH/DELETE /api/guilds/:id/access[/:assignmentId[/suspend|resume]]` | Access & Roles |
| `GET/PATCH /api/guilds/:id/settings` | Thresholds, channels, feature toggles |
| `GET/POST/DELETE /api/guilds/:id/integrations[/:id]` · `POST /test` | Adapters and diagnostics |
| `GET /api/guilds/:id/reports` · `GET /reports/export?format=csv|png|pdf` | Reports |
| `GET /api/guilds/:id/audit` · `/notifications` | Audit and notification history |
| `GET /api/guilds/:id/roles` · `/members?q=` | Live role and member lookup (manage-roles scope only) |

All error responses use `{ "ok": false, "error": "…" }` with an appropriate status code. Authorization failures return 403 and are audited.

---

## 7. Reverse proxy (Caddy example)

```caddy
staff.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:3000
}
```

Keep `WEB_BASE_URL=https://staff.example.com`, `OAUTH2_REDIRECT_URI=https://staff.example.com/auth/callback`, `COOKIE_SECURE=true`, and `WEB_TRUST_PROXY=true` only when the proxy is trusted and sets `X-Forwarded-For`.

Nginx must pass SSE without buffering:

```nginx
location /api/events {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_read_timeout 3600s;
}
```

---

## 8. Operational notes and honest limitations

- The dashboard requires the bot process (or a process that owns the same SQLite file) because OAuth state, sessions, roles and tickets live in SQLite. A separate dashboard process can use the database fallback provider for roles/members, but live ownership revalidation needs the bot client.
- Discord ownership is re-read from the gateway/bot client with a short cache. If the bot is offline, the stored owner ID is used and the UI marks ownership as stored, not verified live.
- Website scans of staff roles use cached guild members and report `PARTIAL` coverage. Use `/staff sync` in Discord for a complete member fetch.
- Discord OAuth2 and live Discord API calls were **not** exercised against a real Discord application in this development environment. The HTTP, session, CSRF, authorization and revocation paths are covered by `tests/09-web-dashboard.test.ts`; OAuth token exchange must be verified in your deployment.
- Integration configuration values are write-only in the UI. The dashboard lists field names but never returns stored secrets.
