import { loadAppConfig } from '../src/config/env';
import { SqliteDatabase } from '../src/database/connection';
import { MigrationRunner } from '../src/database/migrator';

const config = loadAppConfig();
const db = new SqliteDatabase(config.databasePath);
try {
  const runner = new MigrationRunner(db);
  const applied = runner.runMigrations();
  console.log(
    `[TANVEER STAFF MONITOR] Database ready at ${config.databasePath} (${applied.length} new migration(s) applied).`,
  );
} finally {
  db.close();
}
