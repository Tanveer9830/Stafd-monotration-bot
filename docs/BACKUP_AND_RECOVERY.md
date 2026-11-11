# TANVEER STAFF MONITOR — DATABASE BACKUP & POINT-IN-TIME RECOVERY

## 1. Atomic Online Backups

SQLite runs in `WAL` (`Write-Ahead Logging`) mode with `foreign_keys = ON`.
Do **not** copy `.sqlite` files manually with `cp` while the bot is writing without checkpointing or using the online backup API.

### Trigger Backup via CLI
```bash
npm run backup
```
Creates a timestamped backup inside `./data/backups/` using SQLite's atomic online `backup()` API and runs `PRAGMA integrity_check` on the resulting file before reporting success.

### Trigger Backup via Discord (Global Owner)
1. Run `/owner panel`
2. Select **12. System Health**
3. Click **Create Atomic DB Backup**

---

## 2. Safe Database Recovery Procedure

1. **Stop the running bot process** so no open WAL handles remain:
   - Ubuntu VPS: `sudo systemctl stop tanveer-staff-monitor`
   - Pterodactyl: Click **Stop** in the Pterodactyl console
2. **Run the verified restore script:**
   ```bash
   npm run restore -- ./data/backups/<your-backup-filename>.sqlite
   ```
   What `npm run restore` does automatically:
   - Verifies the backup file exists and passes `PRAGMA integrity_check`.
   - Verifies the backup contains the expected `TANVEER STAFF MONITOR` tables.
   - Saves a safety snapshot of your current database to `./data/backups/pre-restore-snapshot-<timestamp>.sqlite`.
   - Removes stale `-wal` and `-shm` sidecar files.
   - Restores the verified backup atomically to `DATABASE_PATH`.
3. **Run schema migrations (in case code was upgraded after the backup):**
   ```bash
   npm run migrate
   ```
4. **Start the bot again:**
   - Ubuntu VPS: `sudo systemctl start tanveer-staff-monitor`
   - Pterodactyl: Click **Start**

---

## 3. PostgreSQL Migration Readiness

All database queries are routed through `IRelationalDatabase` (`src/database/connection.ts`) with parameterized queries, normalized foreign keys, ISO-8601 UTC timestamps, and ACID `transaction()` blocks so migrating high-scale multi-thousand-guild deployments to PostgreSQL (`pg`) requires implementing `IRelationalDatabase` without rewriting business services or command handlers.
