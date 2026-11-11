import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IRelationalDatabase } from './connection';
import { logger } from '../utils/logger';

export interface AppliedMigrationRecord {
  version: string;
  filename: string;
  checksum: string;
  applied_at: string;
}

export class MigrationRunner {
  private readonly db: IRelationalDatabase;
  private readonly migrationsDir: string;

  constructor(db: IRelationalDatabase, customMigrationsDir?: string) {
    this.db = db;
    this.migrationsDir = customMigrationsDir ?? this.resolveMigrationsDir();
  }

  private resolveMigrationsDir(): string {
    const candidates = [
      path.resolve(__dirname, 'migrations'),
      path.resolve(process.cwd(), 'src/database/migrations'),
    ];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }
    throw new Error(`Migrations directory not found. Checked: ${candidates.join(', ')}`);
  }

  public runMigrations(): AppliedMigrationRecord[] {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const existing = new Map<string, AppliedMigrationRecord>(
      this.db
        .all<AppliedMigrationRecord>('SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version ASC')
        .map((r) => [r.version, r]),
    );

    const newlyApplied: AppliedMigrationRecord[] = [];

    for (const filename of files) {
      const version = filename.split('_')[0];
      const fullPath = path.join(this.migrationsDir, filename);
      const sqlContent = fs.readFileSync(fullPath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

      const already = existing.get(version);
      if (already) {
        if (already.checksum !== checksum) {
          throw new Error(
            `Migration checksum mismatch for version ${version} (${filename}). Expected ${already.checksum}, got ${checksum}.`,
          );
        }
        continue;
      }

      const appliedAt = new Date().toISOString();
      this.db.transaction(() => {
        this.db.exec(sqlContent);
        this.db.run(
          'INSERT INTO schema_migrations (version, filename, checksum, applied_at) VALUES (?, ?, ?, ?)',
          [version, filename, checksum, appliedAt],
        );
      });

      const record: AppliedMigrationRecord = { version, filename, checksum, applied_at: appliedAt };
      newlyApplied.push(record);
      logger.info({ version, filename }, 'Applied SQLite schema migration');
    }

    return newlyApplied;
  }

  public listAppliedMigrations(): AppliedMigrationRecord[] {
    return this.db.all<AppliedMigrationRecord>(
      'SELECT version, filename, checksum, applied_at FROM schema_migrations ORDER BY version ASC',
    );
  }
}
