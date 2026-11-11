# TANVEER STAFF MONITOR — Environment Variables

Copy `.env.example` to `.env` or run `npm run setup`. The installer never overwrites an existing `.env`. Keep the file mode `0600`; never commit it.

---

## Required

| Variable | Example | Description |
|---|---|---|
| `DISCORD_TOKEN` | `your_bot_token` | Bot token from the Discord Developer Portal → Bot. Required to start. |
| `DISCORD_CLIENT_ID` | `123456789012345678` | Application ID. Used for OAuth and slash-command registration. |

## Identity

| Variable | Default | Description |
|---|---|---|
| `GLOBAL_OWNER_ID` | `1131248987173814336` | Permanently locked. Any other value is rejected/ignored. The Global Owner is matched by exact user ID only. |

## Database and storage

| Variable | Default | Description |
|---|---|---|
| `DATABASE_PATH` | `./data/tanveer-monitor.sqlite` | SQLite file. Use persistent storage, never `/tmp`. |
| `DATABASE_BACKUP_DIR` | `./data/backups` | Destination for verified online backups. |
| `REPORT_EXPORT_DIR` | `./data/exports` | Temporary CSV/PNG/PDF report output. |

The schema is SQLite with versioned migrations and a Postgres-ready repository boundary (`IRelationalDatabase`). SQLite remains the supported deployment database in v1.

## Gateway intents

| Variable | Default | Description |
|---|---|---|
| `ENABLE_GUILD_MEMBERS_INTENT` | `true` | Enables complete staff roster discovery. Also enable Server Members in the portal. |
| `ENABLE_PRESENCE_INTENT` | `false` | Optional online-status capture. Not evidence of work. |
| `ENABLE_MESSAGE_CONTENT_INTENT` | `false` | Enables plain-text ticket content. Enable only if necessary and approved by Discord. |

## Scheduler

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_SCAN_INTERVAL_MINUTES` | `360` | Default six-hour monitoring interval for new guilds. |
| `SCHEDULER_TICK_SECONDS` | `60` | Scheduler tick cadence. |
| `AUTO_REGISTER_COMMANDS_ON_STARTUP` | `true` | Registers the 18 roots / 100 operations at startup. |

## Tickets

Automatic-claim window, transcript retention and session lifetime are stored in `system_settings` and editable by the Global Owner on the System Health page (and via `/owner`/API). They are not environment variables, so a restart cannot silently reset an operator's choice. Defaults are seeded by migration 003: 5 minutes, 180 days and 168 hours.

## Website dashboard

| Variable | Default | Description |
|---|---|---|
| `WEB_ENABLED` | `true` | Set `false` to run the bot without the HTTP dashboard. |
| `WEB_HOST` | `0.0.0.0` | Bind address. Use `127.0.0.1` behind a local reverse proxy. |
| `WEB_PORT` | `3000` | HTTP port. |
| `WEB_BASE_URL` | `http://localhost:3000` | Public origin used for OAuth redirects, cookie security and origin checks. Use `https://` in production. |
| `DISCORD_CLIENT_SECRET` | *(empty)* | OAuth2 client secret. Required for dashboard sign-in. |
| `OAUTH2_REDIRECT_URI` | `${WEB_BASE_URL}/auth/callback` | Must match the Discord Developer Portal redirect exactly. |
| `COOKIE_SECURE` | `auto` | `auto` sets Secure when `WEB_BASE_URL` is HTTPS. `true`/`false` force it. |
| `WEB_TRUST_PROXY` | `false` | Trust `X-Forwarded-For` only behind a trusted reverse proxy. |

## Logging

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` | Use `test` for silent test runs. |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. Secrets are redacted by pino. |

---

## Notes

- Changing `WEB_BASE_URL`, `OAUTH2_REDIRECT_URI` or `DISCORD_CLIENT_SECRET` requires a restart.
- Changing thresholds can be done at runtime through `/settings inactivity` or the dashboard; those values live in SQLite, not `.env`.
- The Global Owner identity is never read from a mutable setting.
- `.env` is excluded from Git by `.gitignore`. Backup archives do not include `.env`; back it up separately in a secret manager.
