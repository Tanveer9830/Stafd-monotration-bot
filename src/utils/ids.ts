import crypto from 'node:crypto';

export function generateEntityId(prefix: string): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${prefix}-${ts}-${rand}`;
}

const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

export function isValidSnowflake(id: unknown): id is string {
  return typeof id === 'string' && DISCORD_SNOWFLAKE_REGEX.test(id.trim());
}

export function formatDurationHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return '0h 0m';
  const wholeHours = Math.floor(hours);
  const mins = Math.round((hours - wholeHours) * 60);
  if (wholeHours >= 24) {
    const days = Math.floor(wholeHours / 24);
    const remHours = wholeHours % 24;
    return `${days}d ${remHours}h ${mins}m`;
  }
  return `${wholeHours}h ${mins}m`;
}

export function formatSecondsCompact(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return 'N/A';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  const hrs = Math.floor(sec / 3600);
  const mins = Math.round((sec % 3600) / 60);
  return `${hrs}h ${mins}m`;
}

export function formatDiscordTimestamp(iso: string | null | undefined, style: 'R' | 'f' | 'F' | 'd' = 'R'): string {
  if (!iso) return 'Never Observed';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}
