# TANVEER STAFF MONITOR — Access & Roles

Central authorization applies to **every** slash command, button, modal, select menu, HTTP API route and SSE subscription. There is no client-only permission check.

---

## 1. Identity rules

| Identity | Verification | Cannot be changed by |
|---|---|---|
| **Permanent Global Owner** `1131248987173814336` | Exact user ID compared in code (`src/config/branding.ts`) | Commands, settings, database screens, website forms, environment values other than the locked ID |
| **Server Owner** | Live Discord `guild.ownerId` via the bot client, cached briefly; stored owner is a documented fallback when the bot cannot fetch the guild | Username, nickname, Discord role names, holding Administrator permission |
| **Global Administrator** | Row in `web_role_assignments` with `guild_id = NULL`, `role = 'GLOBAL_ADMIN'`, `status = 'ACTIVE'`, unexpired | Deriving from Discord roles or server ownership |
| **Local roles** | `web_role_assignments` rows scoped to one `guild_id`, plus legacy `guild_permission_assignments` | Another guild's assignment; global scope |
| **Active staff** | `staff_profiles.is_currently_staff = 1` (discovered from configured staff roles) | Web roles; staff discovery only |

The environment `GLOBAL_OWNER_ID` is validated against the locked ID; any other value is rejected or ignored.

---

## 2. Website roles

| Role | Where it applies | Default scopes | Notes |
|---|---|---|---|
| `GLOBAL_ADMIN` | Platform | `GLOBAL_SYSTEM` | Allowed scopes are the full global list; default is only system health. No automatic cross-server data. |
| `SERVER_CO_OWNER` | One guild | `SERVER_VIEW_OVERVIEW`, `SERVER_VIEW_STAFF`, `SERVER_VIEW_TICKETS`, `SERVER_VIEW_TRANSCRIPTS`, `SERVER_VIEW_ANALYTICS`, `SERVER_VIEW_AUDIT`, `SERVER_EXPORT_REPORTS`, `SERVER_MANAGE_STAFF`, `SERVER_MANAGE_TICKETS`, `SERVER_MANAGE_SETTINGS`, `SERVER_MANAGE_ROLES`, `SERVER_MANAGE_REVIEWS`, `SERVER_MANAGE_WARNINGS`, `SERVER_MANAGE_LEAVE`, `SERVER_MANAGE_APPEALS`, `SERVER_MANAGE_INTEGRATIONS`, `STAFF_SELF_VIEW` | May grant `SERVER_ADMIN`, `SERVER_VIEWER`, `STAFF_VIEWER` |
| `SERVER_ADMIN` | One guild | `SERVER_VIEW_OVERVIEW`, `SERVER_VIEW_STAFF`, `SERVER_VIEW_TICKETS`, `SERVER_VIEW_ANALYTICS`, `SERVER_EXPORT_REPORTS`, `SERVER_MANAGE_STAFF`, `SERVER_MANAGE_TICKETS`, `SERVER_MANAGE_REVIEWS`, `SERVER_MANAGE_WARNINGS`, `SERVER_MANAGE_LEAVE` | No transcripts, audit, settings, roles, appeals or integrations by default. May grant `SERVER_VIEWER`, `STAFF_VIEWER` |
| `SERVER_VIEWER` | One guild | `SERVER_VIEW_OVERVIEW`, `SERVER_VIEW_STAFF`, `SERVER_VIEW_ANALYTICS`, `STAFF_SELF_VIEW` | Read-only; no ticket browser by default |
| `STAFF_VIEWER` | One guild | `STAFF_SELF_VIEW` | Own staff record, own leave, own appeals |

The authoritative defaults and allowed scope sets are `ROLE_DEFAULT_SCOPES` and `ROLE_ALLOWED_SCOPES` in `src/types/access.ts`. The Access & Roles panel reads those values through `/api/guilds/:id/access`, so the form can never offer a scope the backend would reject.

### Local scopes

`SERVER_VIEW_OVERVIEW`, `SERVER_VIEW_STAFF`, `SERVER_MANAGE_STAFF`, `SERVER_VIEW_TICKETS`, `SERVER_MANAGE_TICKETS`, `SERVER_VIEW_TRANSCRIPTS`, `SERVER_VIEW_ANALYTICS`, `SERVER_MANAGE_REVIEWS`, `SERVER_MANAGE_WARNINGS`, `SERVER_MANAGE_APPEALS`, `SERVER_MANAGE_LEAVE`, `SERVER_MANAGE_SETTINGS`, `SERVER_MANAGE_ROLES`, `SERVER_VIEW_AUDIT`, `SERVER_EXPORT_REPORTS`, `SERVER_MANAGE_INTEGRATIONS`, `STAFF_SELF_VIEW`.

### Global scopes

`GLOBAL_VIEW_ALL`, `GLOBAL_MANAGE_ADMINS`, `GLOBAL_ANALYTICS`, `GLOBAL_VIEW_AUDIT`, `GLOBAL_SYSTEM`, `GLOBAL_BACKUP`, `GLOBAL_SECURITY`, `GLOBAL_INTEGRATIONS`, `GLOBAL_MANAGE_GUILDS`, `GLOBAL_MANAGE_ROLES`.

Global scopes are never combined with local scopes automatically. A Global Administrator with `GLOBAL_VIEW_ALL` can see the platform inventory, but that is an explicit grant; without it, `/api/global/overview` returns 403 and the platform navigation hides the page.

---

## 3. Assigning access (website)

1. Sign in as the Server Owner, Global Owner, or a role holding `SERVER_MANAGE_ROLES`.
2. Open **Access & Roles** in the server sidebar.
3. Choose **Assign role**.
4. Search for a Discord member. The server verifies membership live (`isMemberOfGuild`) before creating a local assignment.
5. Select a role. Only roles your actor kind may grant are offered.
6. Choose explicit scopes from the role's allowed list. Defaults are preselected but can be reduced.
7. Optionally set an expiry and a reason.
8. Save. The assignment and audit entry are written in one service call.

Global Administrators are assigned from **Global Administrators** by the Permanent Global Owner only. The website rejects assignment of `GLOBAL_ADMIN` at server scope.

### Editing, suspending, revoking

- **Edit** changes scopes and expiry. Fields outside the role's allowed scopes are rejected.
- **Suspend** preserves history but removes effective permissions immediately.
- **Resume** restores an active assignment if it has not expired.
- **Remove** sets `status = REVOKED` and records who/why. Effective access is recomputed on every request; no cached authorization survives.
- Expired assignments are transitioned to `EXPIRED` by the service before reads.

### Protection against self-promotion and escalation

`WebRoleService` enforces, server-side:

1. An actor cannot assign or modify their own role (`SELF_PROMOTION_BLOCKED`).
2. A local actor cannot assign `GLOBAL_ADMIN` or any global scope (`GLOBAL_ADMIN_ASSIGNMENT_DENIED`).
3. A role can only be granted if it is in the actor's `GRANTABLE_ROLES`.
4. Requested scopes must be within `ROLE_ALLOWED_SCOPES` for the target role.
5. A local actor can only manage assignments in the same guild, and only if they hold `SERVER_MANAGE_ROLES`.
6. The Server Owner and Global Owner identities are never stored as editable assignments.
7. Expiry is bounded to 3650 days; malformed IDs are rejected.

Every denied attempt is written to `audit_logs` as an `UNAUTHORIZED_ATTEMPT` and is visible on **Access & Roles → Audit history** (if permitted) and **Sessions & Security** for the Global Owner.

---

## 4. Effective permission resolution

```
Global Owner?                  → all global + all local scopes for every guild
Server Owner (live Discord)?   → all local scopes for that guild only
Active web assignments         → union of explicitly granted scopes (unexpired, ACTIVE)
Legacy guild assignments       → mapped to equivalent local scopes
Active staff with no scopes   → STAFF_SELF_VIEW only
```

- A Global Administrator is **not** treated as a Server Owner.
- A Server Owner of guild A gets nothing in guild B.
- Website roles are additive; they never subtract from the Server Owner's access.
- The Global Owner cannot be demoted or removed by any command or UI.

### Permission matrix

| Action | Global Owner | Global Admin | Server Owner | Server Co-Owner | Server Admin | Viewer |
|---|---|---|---|---|---|---|
| View all servers | Yes | No (unless explicit `GLOBAL_VIEW_ALL`) | No | No | No | No |
| Global analytics | Yes | No (unless explicit `GLOBAL_ANALYTICS`) | No | No | No | No |
| View own server | Yes | Scoped | Yes | Granted scope | Granted scope | Granted scope |
| Manage own server | Yes | Scoped | Yes | Granted scope | Granted scope | No |
| Manage local roles | Yes | No | Yes | Only if granted | Only if granted | No |
| Add local admin | Yes | No | Yes | Only if granted | No by default | No |
| Add local co-owner | Yes | No | Yes | No by default | No | No |
| Manage global admins | Yes | No | No | No | No | No |
| Change Global Owner | No | No | No | No | No | No |
| View other servers | Yes | No | No | No | No | No |
| View all conversations globally | Yes | No | No | No | No | No |

---

## 5. Role assignment audit history

The following events are recorded with actor ID, timestamp, guild, target and metadata:

- `WEB_ROLE_ASSIGNED`, `WEB_ROLE_UPDATED`, `WEB_ROLE_SUSPENDED`, `WEB_ROLE_RESUMED`, `WEB_ROLE_REVOKED`
- `SELF_PROMOTION_BLOCKED`, `ROLE_GRANT_DENIED`, `GLOBAL_ADMIN_ASSIGNMENT_DENIED`
- `LOCAL_SCOPE_DENIED`, `GLOBAL_SCOPE_DENIED`, `WEB_GLOBAL_OWNER_DENIED`
- `TICKET_TRANSCRIPT_ACCESSED`
- `LOGIN_SUCCESS`, `SESSION_REVOKED`, `OAUTH_STATE_REJECTED`

Guild audit queries cannot return another guild's rows: `AuditService.listGuildLogs` requires a guild ID and filters by it. Global logs require the Global Owner or `GLOBAL_VIEW_AUDIT`.

---

## 6. Immediate revocation

There is intentionally **no authorization cache** for web roles. `AuthzService.resolveGuildAccess` queries assignments on each request. When a role is suspended or removed:

- The next HTTP request returns 403 for gated routes.
- An open SSE connection is closed within one heartbeat (25 seconds) because the server revalidates the session and permissions.
- Discord slash commands resolve access from live guild data and the database at execution time.

Session revocation is separate from role revocation: removing a role keeps the user signed in but with no access; revoking the session signs them out. Both are available in **Sessions & Security**.
