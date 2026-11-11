import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { SqliteDatabase } from './connection';
import { logger } from '../utils/logger';

export interface BackupMetadata {
  filename: string;
  fullPath: string;
  sizeBytes: number;
  createdAt: string;
  integrityOk: boolean;
}

export class DatabaseBackupService {
  private readonly db: SqliteDatabase;
  private readonly backupDir: string;

  constructor(db: SqliteDatabase, backupDir: string) {
    this.db = db;
    this.backupDir = path.resolve(backupDir);
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  public async createBackup(label = 'scheduled'): Promise<BackupMetadata> {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `tanveer-monitor-${safeLabel}-${stamp}.sqlite`;
    const fullPath = path.join(this.backupDir, filename);

    await this.db.raw.backup(fullPath);

    const verifyDb = new Database(fullPath, { readonly: true });
    let integrityOk = false;
    try {
      const check = verifyDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      integrityOk = check.length === 1 && check[0].integrity_check === 'ok';
    } finally {
      verifyDb.close();
    }

    if (!integrityOk) {
      throw new Error(`Backup integrity check failed for ${fullPath}`);
    }

    const stat = fs.statSync(fullPath);
    const meta: BackupMetadata = {
      filename,
      fullPath,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
      integrityOk,
    };

    logger.info({ filename, sizeBytes: meta.sizeBytes }, 'Database backup created and verified');
    return meta;
  }

  public listBackups(): BackupMetadata[] {
    if (!fs.existsSync(this.backupDir)) return [];
    return fs
      .readdirSync(this.backupDir)
      .filter((f) => f.endsWith('.sqlite') || f.endsWith('.db'))
      .map((filename) => {
        const fullPath = path.join(this.backupDir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          fullPath,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
          integrityOk: true,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Validates a backup file and restores it onto a target database file path,
   * creating a pre-restore safety snapshot if the target already exists.
   */
  public static restoreFromBackupFile(
    backupFilePath: string,
    targetDbPath: string,
    safetySnapshotDir: string,
  ): { restoredPath: string; preRestoreSnapshotPath: string | null } {
    const resolvedBackup = path.resolve(backupFilePath);
    const resolvedTarget = path.resolve(targetDbPath);
    if (!fs.existsSync(resolvedBackup)) {
      throw new Error(`Backup file not found: ${resolvedBackup}`);
    }

    const checkDb = new Database(resolvedBackup, { readonly: true });
    try {
      const check = checkDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (check.length !== 1 || check[0].integrity_check !== 'ok') {
        throw new Error(`Refusing to restore corrupted backup: ${resolvedBackup}`);
      }
      const tables = checkDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='guild_config'")
        .get();
      if (!tables) {
        throw new Error(`Backup file does not contain expected TANVEER STAFF MONITOR schema: ${resolvedBackup}`);
      }
    } finally {
      checkDb.close();
    }

    let preRestoreSnapshotPath: string | null = null;
    if (fs.existsSync(resolvedTarget)) {
      fs.mkdirSync(safetySnapshotDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      preRestoreSnapshotPath = path.join(safetySnapshotDir, `pre-restore-snapshot-${stamp}.sqlite`);
      fs.copyFileSync(resolvedTarget, preRestoreSnapshotPath);
    }

    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${resolvedTarget}${suffix}`;
      if (fs.existsSync(sidecar)) {
        fs.unlinkSync(sidecar);
      }
    }

    fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true });
    fs.copyFileSync(resolvedBackup, resolvedTarget);

    return {
      restoredPath: resolvedTarget,
      preRestoreSnapshotPath,
    };
  }
}
