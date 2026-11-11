import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { GLOBAL_OWNER_ID } from './branding';
import { logger } from '../utils/logger';

dotenv.config();

const EnvSchema = z.object({
  DISCORD_TOKEN: z.string().default(''),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_DEV_GUILD_ID: z.string().optional().default(''),
  GLOBAL_OWNER_ID: z.string().optional().default(GLOBAL_OWNER_ID),
  DATABASE_PATH: z.string().default('./data/tanveer-monitor.sqlite'),
  DATABASE_BACKUP_DIR: z.string().default('./data/backups'),
  REPORT_EXPORT_DIR: z.string().default('./data/exports'),
  ENABLE_GUILD_MEMBERS_INTENT: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  ENABLE_PRESENCE_INTENT: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  ENABLE_MESSAGE_CONTENT_INTENT: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  DEFAULT_SCAN_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(1440).default(360),
  SCHEDULER_TICK_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  AUTO_REGISTER_COMMANDS_ON_STARTUP: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  WEB_ENABLED: z
    .string()
    .optional()
    .default('true')
    .transform((v) => v.toLowerCase() !== 'false'),
  WEB_HOST: z.string().optional().default('0.0.0.0'),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WEB_BASE_URL: z.string().optional().default(''),
  DISCORD_CLIENT_SECRET: z.string().optional().default(''),
  OAUTH2_REDIRECT_URI: z.string().optional().default(''),
  COOKIE_SECURE: z.string().optional().default('auto'),
  WEB_TRUST_PROXY: z
    .string()
    .optional()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.string().default('info'),
});

export interface AppConfig {
  readonly discordToken: string;
  readonly discordClientId: string;
  readonly discordDevGuildId: string;
  readonly globalOwnerId: typeof GLOBAL_OWNER_ID;
  readonly databasePath: string;
  readonly databaseBackupDir: string;
  readonly reportExportDir: string;
  readonly enableGuildMembersIntent: boolean;
  readonly enablePresenceIntent: boolean;
  readonly enableMessageContentIntent: boolean;
  readonly defaultScanIntervalMinutes: number;
  readonly schedulerTickSeconds: number;
  readonly autoRegisterCommandsOnStartup: boolean;
  readonly webEnabled: boolean;
  readonly webHost: string;
  readonly webPort: number;
  readonly webBaseUrl: string;
  readonly discordClientSecret: string;
  readonly oauth2RedirectUri: string;
  readonly cookieSecure: 'auto' | 'true' | 'false';
  readonly webTrustProxy: boolean;
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly logLevel: string;
}

export function loadAppConfig(overrides: Record<string, string | undefined> = {}): AppConfig {
  const merged = { ...process.env, ...overrides };
  const parsed = EnvSchema.parse(merged);

  if (parsed.GLOBAL_OWNER_ID && parsed.GLOBAL_OWNER_ID !== GLOBAL_OWNER_ID) {
    logger.warn(
      { attemptedOverrideId: parsed.GLOBAL_OWNER_ID, enforcedGlobalOwnerId: GLOBAL_OWNER_ID },
      'Attempted GLOBAL_OWNER_ID override detected in environment; permanent Global Owner ID remains strictly enforced.',
    );
  }

  const resolvedDbPath = path.resolve(process.cwd(), parsed.DATABASE_PATH);
  if (
    parsed.NODE_ENV !== 'test' &&
    (resolvedDbPath.startsWith('/tmp/') || resolvedDbPath.startsWith('/var/tmp/'))
  ) {
    throw new Error(
      `Unsafe DATABASE_PATH "${resolvedDbPath}": SQLite database must reside in persistent storage, never in a temporary directory.`,
    );
  }

  return Object.freeze({
    discordToken: parsed.DISCORD_TOKEN,
    discordClientId: parsed.DISCORD_CLIENT_ID,
    discordDevGuildId: parsed.DISCORD_DEV_GUILD_ID,
    globalOwnerId: GLOBAL_OWNER_ID,
    databasePath: resolvedDbPath,
    databaseBackupDir: path.resolve(process.cwd(), parsed.DATABASE_BACKUP_DIR),
    reportExportDir: path.resolve(process.cwd(), parsed.REPORT_EXPORT_DIR),
    enableGuildMembersIntent: parsed.ENABLE_GUILD_MEMBERS_INTENT,
    enablePresenceIntent: parsed.ENABLE_PRESENCE_INTENT,
    enableMessageContentIntent: parsed.ENABLE_MESSAGE_CONTENT_INTENT,
    defaultScanIntervalMinutes: parsed.DEFAULT_SCAN_INTERVAL_MINUTES,
    schedulerTickSeconds: parsed.SCHEDULER_TICK_SECONDS,
    autoRegisterCommandsOnStartup: parsed.AUTO_REGISTER_COMMANDS_ON_STARTUP,
    webEnabled: parsed.WEB_ENABLED,
    webHost: parsed.WEB_HOST,
    webPort: parsed.WEB_PORT,
    webBaseUrl: parsed.WEB_BASE_URL || `http://localhost:${parsed.WEB_PORT}`,
    discordClientSecret: parsed.DISCORD_CLIENT_SECRET,
    oauth2RedirectUri:
      parsed.OAUTH2_REDIRECT_URI || `${parsed.WEB_BASE_URL || `http://localhost:${parsed.WEB_PORT}`}/auth/callback`,
    cookieSecure:
      parsed.COOKIE_SECURE === 'true' ? 'true' : parsed.COOKIE_SECURE === 'false' ? 'false' : 'auto',
    webTrustProxy: parsed.WEB_TRUST_PROXY,
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
  });
}
