import { IRelationalDatabase } from '../database/connection';
import { isPermanentGlobalOwner } from '../config/branding';
import { ALL_FEATURE_KEYS, DEFAULT_FEATURE_STATES, FeatureKey, FEATURE_LABELS } from '../types/domain';
import { AuditService } from './AuditService';
import { GuildConfigService } from './GuildConfigService';

export interface EffectiveFeatureStatus {
  key: FeatureKey;
  label: string;
  guildEnabled: boolean;
  globallyDisabled: boolean;
  effectiveEnabled: boolean;
}

export class FeatureService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, guildConfig: GuildConfigService, audit: AuditService) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.audit = audit;
  }

  public getGloballyDisabledFeatures(): Set<FeatureKey> {
    const globalCfg = this.guildConfig.getGlobalConfig();
    try {
      const parsed = JSON.parse(globalCfg.globally_disabled_features_json) as string[];
      return new Set(parsed.filter((k): k is FeatureKey => ALL_FEATURE_KEYS.includes(k as FeatureKey)));
    } catch {
      return new Set();
    }
  }

  /**
   * Global Owner only: enables or disables a feature globally across every server.
   * Never deletes historical records.
   */
  public setGlobalFeatureRestriction(actorUserId: string, featureKey: FeatureKey, globallyAllowed: boolean): void {
    if (!isPermanentGlobalOwner(actorUserId)) {
      throw new Error('Forbidden: Only the Permanent Global Owner can change global feature restrictions.');
    }

    const disabledSet = this.getGloballyDisabledFeatures();
    const before = Array.from(disabledSet);

    if (globallyAllowed) {
      disabledSet.delete(featureKey);
    } else {
      disabledSet.add(featureKey);
    }

    const after = Array.from(disabledSet);
    const now = new Date().toISOString();
    this.db.run('UPDATE global_config SET globally_disabled_features_json = ?, updated_at = ? WHERE id = 1', [
      JSON.stringify(after),
      now,
    ]);

    this.audit.log({
      actorUserId,
      actionCategory: 'OWNER_SECURITY',
      actionType: globallyAllowed ? 'GLOBAL_FEATURE_UNLOCKED' : 'GLOBAL_FEATURE_DISABLED',
      targetType: 'FEATURE',
      targetId: featureKey,
      before,
      after,
    });
  }

  /**
   * Server Owner / authorized local administrator: toggles a local guild feature.
   * Disabling a feature immediately pauses the runtime service for this guild
   * without erasing any historical data.
   */
  public setGuildFeature(guildId: string, actorUserId: string, featureKey: FeatureKey, enabled: boolean): EffectiveFeatureStatus {
    this.guildConfig.getGuildConfigOrThrow(guildId);
    const globallyDisabled = this.getGloballyDisabledFeatures();
    if (enabled && globallyDisabled.has(featureKey) && !isPermanentGlobalOwner(actorUserId)) {
      throw new Error(
        `Feature "${FEATURE_LABELS[featureKey]}" is currently restricted globally by the Global Owner.`,
      );
    }

    const existing = this.db.get<{ enabled: number }>(
      'SELECT enabled FROM guild_features WHERE guild_id = ? AND feature_key = ?',
      [guildId, featureKey],
    );
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO guild_features (guild_id, feature_key, enabled, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(guild_id, feature_key) DO UPDATE SET
         enabled = excluded.enabled,
         updated_by = excluded.updated_by,
         updated_at = excluded.updated_at`,
      [guildId, featureKey, enabled ? 1 : 0, actorUserId, now],
    );

    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'SETTINGS',
      actionType: enabled ? 'GUILD_FEATURE_ENABLED' : 'GUILD_FEATURE_DISABLED',
      targetType: 'FEATURE',
      targetId: featureKey,
      before: { enabled: existing ? Boolean(existing.enabled) : DEFAULT_FEATURE_STATES[featureKey] },
      after: { enabled },
    });

    return this.getFeatureStatus(guildId, featureKey);
  }

  public isEnabled(guildId: string, featureKey: FeatureKey): boolean {
    if (this.getGloballyDisabledFeatures().has(featureKey)) {
      return false;
    }
    const row = this.db.get<{ enabled: number }>(
      'SELECT enabled FROM guild_features WHERE guild_id = ? AND feature_key = ?',
      [guildId, featureKey],
    );
    if (!row) {
      return DEFAULT_FEATURE_STATES[featureKey];
    }
    return row.enabled === 1;
  }

  public getFeatureStatus(guildId: string, featureKey: FeatureKey): EffectiveFeatureStatus {
    const globallyDisabled = this.getGloballyDisabledFeatures().has(featureKey);
    const row = this.db.get<{ enabled: number }>(
      'SELECT enabled FROM guild_features WHERE guild_id = ? AND feature_key = ?',
      [guildId, featureKey],
    );
    const guildEnabled = row ? row.enabled === 1 : DEFAULT_FEATURE_STATES[featureKey];
    return {
      key: featureKey,
      label: FEATURE_LABELS[featureKey],
      guildEnabled,
      globallyDisabled,
      effectiveEnabled: guildEnabled && !globallyDisabled,
    };
  }

  public listGuildFeatures(guildId: string): EffectiveFeatureStatus[] {
    return ALL_FEATURE_KEYS.map((key) => this.getFeatureStatus(guildId, key));
  }
}
