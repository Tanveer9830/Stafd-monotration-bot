import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';

/**
 * Thin, driver-agnostic SQLite facade.
 *
 * Production uses `better-sqlite3` (bundled native driver). In build environments
 * without a C++ toolchain (CI, some shared hosts) we transparently fall back to
 * Node's built-in `node:sqlite` module (Node >= 22.5) so the platform, migrations
 * and the full test suite can still run. Both drivers expose the same small
 * surface used by the repositories.
 */
export interface StatementLike {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface RawSqliteDriver {
  prepare(sql: string): StatementLike;
  exec(sql: string): void;
  pragma(sql: string): unknown;
  transaction<T>(fn: () => T): () => T;
  backup(destPath: string): Promise<void>;
  close(): void;
}

export type SqliteDriverName = 'better-sqlite3' | 'node:sqlite';

class BetterSqliteDriver implements RawSqliteDriver {
  public readonly name: SqliteDriverName = 'better-sqlite3';
  private readonly db: {
    prepare(sql: string): StatementLike;
    exec(sql: string): void;
    pragma(sql: string): unknown;
    transaction<T>(fn: () => T): () => T;
    backup(destPath: string): Promise<unknown>;
    close(): void;
  };

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require('better-sqlite3');
    this.db = new BetterSqlite3(dbPath);
  }

  public prepare(sql: string): StatementLike {
    return this.db.prepare(sql);
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public pragma(sql: string): unknown {
    return this.db.pragma(sql);
  }

  public transaction<T>(fn: () => T): () => T {
    return this.db.transaction(fn);
  }

  public async backup(destPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    await this.db.backup(destPath);
  }

  public close(): void {
    this.db.close();
  }
}

class NodeSqliteDriver implements RawSqliteDriver {
  public readonly name: SqliteDriverName = 'node:sqlite';
  private readonly db: {
    prepare(sql: string): StatementLike;
    exec(sql: string): void;
    close(): void;
  };
  private transactionDepth = 0;

  constructor(dbPath: string) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeSqlite = require('node:sqlite');
    this.db = new nodeSqlite.DatabaseSync(dbPath);
  }

  public prepare(sql: string): StatementLike {
    const stmt = this.db.prepare(sql);
    return {
      run: (...params: unknown[]) => {
        const normalized = params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
        const res = stmt.run(...normalized);
        return { changes: Number(res.changes), lastInsertRowid: res.lastInsertRowid as number | bigint };
      },
      get: (...params: unknown[]) => {
        const normalized = params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
        return stmt.get(...normalized);
      },
      all: (...params: unknown[]) => {
        const normalized = params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p));
        return stmt.all(...normalized);
      },
    };
  }

  public exec(sql: string): void {
    this.db.exec(sql);
  }

  public pragma(sql: string): unknown {
    const trimmed = sql.trim();
    if (/^(journal_mode|synchronous|busy_timeout|wal_checkpoint|integrity_check|foreign_keys|user_version)/i.test(trimmed)) {
      return this.db.prepare(`PRAGMA ${trimmed}`).all();
    }
    this.db.exec(`PRAGMA ${trimmed}`);
    return [];
  }

  public transaction<T>(fn: () => T): () => T {
    return () => {
      const depth = this.transactionDepth;
      const savepoint = `tsm_sp_${depth}`;
      this.db.exec(depth === 0 ? 'BEGIN' : `SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;
      try {
        const result = fn();
        this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
        return result;
      } catch (err) {
        try {
          this.db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${savepoint}`);
          if (depth > 0) this.db.exec(`RELEASE ${savepoint}`);
        } catch {
          // ignore rollback errors and rethrow original
        }
        throw err;
      } finally {
        this.transactionDepth = depth;
      }
    };
  }

  public async backup(destPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // checkpoint is best-effort
    }
    // node:sqlite's backup API is only available on newer releases; a checkpointed
    // file copy is a safe snapshot for the fallback driver.
    const source = (this.db as unknown as { location(): string }).location?.();
    if (!source) {
      throw new Error('Unable to resolve SQLite database location for backup.');
    }
    fs.copyFileSync(source, destPath);
  }

  public close(): void {
    this.db.close();
  }
}

export interface OpenSqliteOptions {
  readonly?: boolean;
}

export function openRawSqliteDriver(dbPath: string, options: OpenSqliteOptions = {}): RawSqliteDriver {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  if (!options.readonly) {
    try {
      return new BetterSqliteDriver(resolved);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'better-sqlite3 unavailable; falling back to built-in node:sqlite driver. Install build tools or Node >= 22.5 for production parity.',
      );
    }
  }

  return new NodeSqliteDriver(resolved);
}
