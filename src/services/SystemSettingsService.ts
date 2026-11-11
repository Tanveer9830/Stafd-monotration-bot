import { IRelationalDatabase } from '../database/connection';
import { AuditService } from './AuditService';

export const SYSTEM_SETTING_KEYS = [
  'ticket_auto_claim_minutes',
  'ticket_message_retention_days',
  'web_session_hours',
  'monitoring_paused_globally',
] as const;

export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number];

const DEFAULTS: Record<SystemSettingKey, string> = {
  ticket_auto_claim_minutes: '5',
  ticket_message_retention_days: '180',
  web_session_hours: '168',
  monitoring_paused_globally: 'false',
};

const VALIDATORS: Record<SystemSettingKey, (value: string) => boolean> = {
  ticket_auto_claim_minutes: (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 120,
  ticket_message_retention_days: (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 3650,
  web_session_hours: (v) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 720,
  monitoring_paused_globally: (v) => v === 'true' || v === 'false',
};

export class SystemSettingsService {
  private readonly db: IRelationalDatabase;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, audit: AuditService) {
    this.db = db;
    this.audit = audit;
  }

  public get(key: SystemSettingKey): string {
    const row = this.db.get<{ value: string }>('SELECT value FROM system_settings WHERE key = ?', [key]);
    return row?.value ?? DEFAULTS[key];
  }

  public getNumber(key: SystemSettingKey): number {
    const parsed = Number(this.get(key));
    return Number.isFinite(parsed) ? parsed : Number(DEFAULTS[key]);
  }

  public getBoolean(key: SystemSettingKey): boolean {
    return this.get(key) === 'true';
  }

  public set(key: SystemSettingKey, value: string, actorUserId: string, guildId: string | null = null): string {
    if (!SYSTEM_SETTING_KEYS.includes(key)) {
      throw new Error(`Unknown system setting "${String(key)}".`);
    }
    if (!VALIDATORS[key](value)) {
      throw new Error(`Invalid value for system setting ${key}.`);
    }
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO system_settings (key, value, updated_by, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [key, value, actorUserId, now],
    );
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'SETTINGS',
      actionType: 'SYSTEM_SETTING_UPDATED',
      targetType: 'SETTING',
      targetId: key,
      after: { value },
    });
    return value;
  }

  public list(): Array<{ key: SystemSettingKey; value: string }> {
    return SYSTEM_SETTING_KEYS.map((key) => ({ key, value: this.get(key) }));
  }
}
