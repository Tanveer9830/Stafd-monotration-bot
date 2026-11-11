import { loadAppConfig } from '../src/config/env';
import { DatabaseBackupService } from '../src/database/backup';
import { SqliteDatabase } from '../src/database/connection';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const db = new SqliteDatabase(config.databasePath);
  try {
    const backupSvc = new DatabaseBackupService(db, config.databaseBackupDir);
    const meta = await backupSvc.createBackup('cli-manual');
    console.log(`[TANVEER STAFF MONITOR] Backup verified: ${meta.fullPath} (${meta.sizeBytes} bytes)`);
  } finally {
    db.close();
  }
}

void main().catch((err) => {
  console.error('[BACKUP ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
