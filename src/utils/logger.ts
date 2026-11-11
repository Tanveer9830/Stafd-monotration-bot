import pino, { Logger } from 'pino';

export function createAppLogger(level?: string): Logger {
  const logLevel = level ?? process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info');
  return pino({
    name: 'tanveer-staff-monitor',
    level: logLevel,
    redact: {
      paths: [
        'token',
        'discordToken',
        'botToken',
        'DISCORD_TOKEN',
        '*.token',
        '*.discordToken',
        'headers.authorization',
        'config.discordToken',
      ],
      censor: '[REDACTED_SECRET]',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export const logger = createAppLogger();
