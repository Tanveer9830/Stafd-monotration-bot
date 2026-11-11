import fs from 'node:fs';
import path from 'node:path';
import { openRawSqliteDriver, RawSqliteDriver, SqliteDriverName } from './sqliteDriver';
import { logger } from '../utils/logger';

/**
 * PostgreSQL-ready relational store abstraction.
 * Domain repositories interact through parameterized queries and transactions,
 * isolating the SQLite driver so a future PostgreSQL (`pg`) driver can plug in cleanly.
 */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface IRelationalDatabase {
  readonly driverName: 'sqlite' | 'postgres';
  readonly dbPath: string;
  exec(sql: string): void;
  run(sql: string, params?: readonly unknown[]): RunResult;
  get<T>(sql: string, params?: readonly unknown[]): T | undefined;
  all<T>(sql: string, params?: readonly unknown[]): T[];
  transaction<T>(fn: () => T): T;
  integrityCheck(): { ok: boolean; details: string[] };
  close(): void;
}

export class SqliteDatabase implements IRelationalDatabase {
  public readonly driverName = 'sqlite' as const;
  public readonly dbPath: string;
  public readonly raw: RawSqliteDriver;
  public readonly driverNameUsed: SqliteDriverName;
  private closed = false;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    const parentDir = path.dirname(this.dbPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    this.raw = openRawSqliteDriver(this.dbPath);
    this.driverNameUsed = this.raw.constructor.name.includes('Better') ? 'better-sqlite3' : 'node:sqlite';
    this.raw.pragma('journal_mode = WAL');
    this.raw.pragma('foreign_keys = ON');
    this.raw.pragma('synchronous = NORMAL');
    this.raw.pragma('busy_timeout = 5000');
  }

  public exec(sql: string): void {
    this.raw.exec(sql);
  }

  public run(sql: string, params: readonly unknown[] = []): RunResult {
    const stmt = this.raw.prepare(sql);
    const info = stmt.run(...params);
    return {
      changes: info.changes,
      lastInsertRowid: info.lastInsertRowid,
    };
  }

  public get<T>(sql: string, params: readonly unknown[] = []): T | undefined {
    const stmt = this.raw.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  public all<T>(sql: string, params: readonly unknown[] = []): T[] {
    const stmt = this.raw.prepare(sql);
    return stmt.all(...params) as T[];
  }

  public transaction<T>(fn: () => T): T {
    const wrapped = this.raw.transaction(fn);
    return wrapped();
  }

  public integrityCheck(): { ok: boolean; details: string[] } {
    const rows = this.raw.pragma('integrity_check') as Array<{ integrity_check: string }>;
    const details = rows.map((r) => r.integrity_check);
    const ok = details.length === 1 && details[0] === 'ok';
    return { ok, details };
  }

  public checkpointWal(): void {
    if (!this.closed) {
      this.raw.pragma('wal_checkpoint(TRUNCATE)');
    }
  }

  public close(): void {
    if (!this.closed) {
      try {
        this.raw.pragma('wal_checkpoint(PASSIVE)');
      } catch (err) {
        logger.warn({ err }, 'WAL checkpoint warning during database close');
      }
      this.raw.close();
      this.closed = true;
    }
  }
}
