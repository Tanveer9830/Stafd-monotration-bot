import { loadAppConfig } from '../src/config/env';
import { DatabaseBackupService } from '../src/database/backup';

const backupFile = process.argv[2];
if (!backupFile) {
  console.error('Usage: npm run restore -- <path-to-backup.sqlite>');
  process.exit(1);
}

const config = loadAppConfig();
const res = DatabaseBackupService.restoreFromBackupFile(
  backupFile,
  config.databasePath,
  config.databaseBackupDir,
);

console.log(`[TANVEER STAFF MONITOR] Database restored to: ${res.restoredPath}`);
if (res.preRestoreSnapshotPath) {
  console.log(`[SAFEGUARD] Pre-restore safety snapshot saved to: ${res.preRestoreSnapshotPath}`);
}
