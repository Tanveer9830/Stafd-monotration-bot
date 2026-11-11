import { IRelationalDatabase } from '../database/connection';
import { isPermanentGlobalOwner } from '../config/branding';
import {
  ALL_FEATURE_KEYS,
  ApprovalPolicy,
  DEFAULT_FEATURE_STATES,
  FeatureKey,
  GlobalConfigRecord,
  GuildConfigRecord,
} from '../types/domain';
import { AuditService } from './AuditService';

export class GuildConfigService {
  private readonly db: IRelationalDatabase;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, audit: AuditService) {
    this.db = db;
    this.audit = audit;
  }

  public getGlobalConfig(): GlobalConfigRecord {
    const row = this.db.get<GlobalConfigRecord>('SELECT * FROM global_config WHERE id = 1');
    if (!row) {
      throw new Error('Global configuration row missing; ensure migrations have executed.');
    }
    return row;
  }

  public updateGlobalSecurityConfig(
    actorUserId: string,
    updates: Partial<{
      globalApprovalPolicy: ApprovalPolicy;
      allowGuildPolicyOverride: boolean;
      minAtRiskHours: number;
      maxAtRiskHours: number;
      minInactiveHours: number;
      maxInactiveHours: number;
      minEscalationHours: number;
      maxEscalationHours: number;
      defaultScanIntervalMinutes: number;
      requireDmFallbackAlert: boolean;
      rateLimitActionsPerMinute: number;
    }>,
  ): GlobalConfigRecord {
    if (!isPermanentGlobalOwner(actorUserId)) {
      throw new Error('Forbidden: Only the Permanent Global Owner can modify global security policies.');
    }

    const before = this.getGlobalConfig();
    const now = new Date().toISOString();

    const nextPolicy = updates.globalApprovalPolicy ?? before.global_approval_policy;
    const nextOverride =
      updates.allowGuildPolicyOverride !== undefined
        ? updates.allowGuildPolicyOverride
          ? 1
          : 0
        : before.allow_guild_policy_override;
    const minRisk = updates.minAtRiskHours ?? before.min_at_risk_hours;
    const maxRisk = updates.maxAtRiskHours ?? before.max_at_risk_hours;
    const minInact = updates.minInactiveHours ?? before.min_inactive_hours;
    const maxInact = updates.maxInactiveHours ?? before.max_inactive_hours;
    const minEsc = updates.minEscalationHours ?? before.min_escalation_hours;
    const maxEsc = updates.maxEscalationHours ?? before.max_escalation_hours;
    const scanMins = updates.defaultScanIntervalMinutes ?? before.default_scan_interval_minutes;
    const dmFallback =
      updates.requireDmFallbackAlert !== undefined
        ? updates.requireDmFallbackAlert
          ? 1
          : 0
        : before.require_dm_fallback_alert;
    const rateLimit = updates.rateLimitActionsPerMinute ?? before.rate_limit_actions_per_minute;

    if (minRisk < 1 || minRisk > maxRisk || minInact > maxInact || minEsc > maxEsc) {
      throw new Error('Invalid global threshold bounds: min values must not exceed max values.');
    }

    this.db.run(
      `UPDATE global_config SET
        global_approval_policy = ?,
        allow_guild_policy_override = ?,
        min_at_risk_hours = ?,
        max_at_risk_hours = ?,
        min_inactive_hours = ?,
        max_inactive_hours = ?,
        min_escalation_hours = ?,
        max_escalation_hours = ?,
        default_scan_interval_minutes = ?,
        require_dm_fallback_alert = ?,
        rate_limit_actions_per_minute = ?,
        updated_at = ?
      WHERE id = 1`,
      [
        nextPolicy,
        nextOverride,
        minRisk,
        maxRisk,
        minInact,
        maxInact,
        minEsc,
        maxEsc,
        scanMins,
        dmFallback,
        rateLimit,
        now,
      ],
    );

    const after = this.getGlobalConfig();
    this.audit.log({
      actorUserId,
      actionCategory: 'OWNER_SECURITY',
      actionType: 'GLOBAL_SECURITY_POLICY_UPDATED',
      targetType: 'GLOBAL_CONFIG',
      targetId: '1',
      before,
      after,
    });

    return after;
  }

  /**
   * Registers a guild if new, or synchronizes guild name and current Discord owner_id
   * so server ownership transfers automatically update local permissions.
   */
  public ensureGuildRegistered(guildId: string, guildName: string, currentOwnerId: string): GuildConfigRecord {
    const existing = this.db.get<GuildConfigRecord>('SELECT * FROM guild_config WHERE guild_id = ?', [guildId]);
    const now = new Date().toISOString();

    if (!existing) {
      const globalCfg = this.getGlobalConfig();
      this.db.transaction(() => {
        this.db.run(
          `INSERT INTO guild_config (
            guild_id, guild_name, owner_id, at_risk_hours, inactive_hours, escalation_hours,
            observation_baseline_hours, scan_interval_minutes, installed_at, updated_at
          ) VALUES (?, ?, ?, 24, 48, 72, 24, ?, ?, ?)`,
          [guildId, guildName, currentOwnerId, globalCfg.default_scan_interval_minutes, now, now],
        );

        for (const key of ALL_FEATURE_KEYS) {
          this.db.run(
            `INSERT OR IGNORE INTO guild_features (guild_id, feature_key, enabled, updated_by, updated_at)
             VALUES (?, ?, ?, 'SYSTEM_INIT', ?)`,
            [guildId, key, DEFAULT_FEATURE_STATES[key] ? 1 : 0, now],
          );
        }
      });

      return this.getGuildConfigOrThrow(guildId);
    }

    if (existing.owner_id !== currentOwnerId || existing.guild_name !== guildName) {
      this.db.run(
        'UPDATE guild_config SET guild_name = ?, owner_id = ?, updated_at = ? WHERE guild_id = ?',
        [guildName, currentOwnerId, now, guildId],
      );
      if (existing.owner_id !== currentOwnerId) {
        this.audit.log({
          guildId,
          actorUserId: currentOwnerId,
          actionCategory: 'PERMISSIONS',
          actionType: 'GUILD_OWNERSHIP_TRANSFERRED',
          targetType: 'GUILD',
          targetId: guildId,
          before: { owner_id: existing.owner_id },
          after: { owner_id: currentOwnerId },
        });
      }
      return this.getGuildConfigOrThrow(guildId);
    }

    return existing;
  }

  public getGuildConfig(guildId: string): GuildConfigRecord | undefined {
    return this.db.get<GuildConfigRecord>('SELECT * FROM guild_config WHERE guild_id = ?', [guildId]);
  }

  public getGuildConfigOrThrow(guildId: string): GuildConfigRecord {
    const cfg = this.getGuildConfig(guildId);
    if (!cfg) {
      throw new Error(`Guild ${guildId} is not registered.`);
    }
    return cfg;
  }

  public listAllGuilds(): GuildConfigRecord[] {
    return this.db.all<GuildConfigRecord>('SELECT * FROM guild_config ORDER BY guild_name ASC');
  }

  public resolveEffectiveApprovalPolicy(guildId: string): ApprovalPolicy {
    const globalCfg = this.getGlobalConfig();
    if (!globalCfg.allow_guild_policy_override) {
      return globalCfg.global_approval_policy;
    }
    const guildCfg = this.getGuildConfig(guildId);
    return guildCfg?.approval_policy_override ?? globalCfg.global_approval_policy;
  }

  public updateInactivityThresholds(
    guildId: string,
    actorUserId: string,
    input: {
      atRiskHours?: number;
      inactiveHours?: number;
      escalationHours?: number;
      observationBaselineHours?: number;
      scanIntervalMinutes?: number;
    },
  ): GuildConfigRecord {
    const before = this.getGuildConfigOrThrow(guildId);
    const globalCfg = this.getGlobalConfig();

    const atRisk = input.atRiskHours ?? before.at_risk_hours;
    const inactive = input.inactiveHours ?? before.inactive_hours;
    const escalation = input.escalationHours ?? before.escalation_hours;
    const baseline = input.observationBaselineHours ?? before.observation_baseline_hours;
    const scanInterval = input.scanIntervalMinutes ?? before.scan_interval_minutes;

    if (atRisk < globalCfg.min_at_risk_hours || atRisk > globalCfg.max_at_risk_hours) {
      throw new Error(
        `At-risk threshold (${atRisk}h) is outside Global Owner security bounds (${globalCfg.min_at_risk_hours}h–${globalCfg.max_at_risk_hours}h).`,
      );
    }
    if (inactive < globalCfg.min_inactive_hours || inactive > globalCfg.max_inactive_hours) {
      throw new Error(
        `Inactivity threshold (${inactive}h) is outside Global Owner security bounds (${globalCfg.min_inactive_hours}h–${globalCfg.max_inactive_hours}h).`,
      );
    }
    if (escalation < globalCfg.min_escalation_hours || escalation > globalCfg.max_escalation_hours) {
      throw new Error(
        `Escalation threshold (${escalation}h) is outside Global Owner security bounds (${globalCfg.min_escalation_hours}h–${globalCfg.max_escalation_hours}h).`,
      );
    }
    if (!(atRisk <= inactive && inactive <= escalation)) {
      throw new Error(
        `Thresholds must satisfy At-Risk (${atRisk}h) <= Inactive (${inactive}h) <= Escalation (${escalation}h).`,
      );
    }
    if (scanInterval < 15 || scanInterval > 1440) {
      throw new Error('Scan interval must be between 15 and 1440 minutes.');
    }

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE guild_config SET
        at_risk_hours = ?,
        inactive_hours = ?,
        escalation_hours = ?,
        observation_baseline_hours = ?,
        scan_interval_minutes = ?,
        updated_at = ?
      WHERE guild_id = ?`,
      [atRisk, inactive, escalation, baseline, scanInterval, now, guildId],
    );

    const after = this.getGuildConfigOrThrow(guildId);
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'SETTINGS',
      actionType: 'INACTIVITY_THRESHOLDS_UPDATED',
      targetType: 'GUILD_CONFIG',
      targetId: guildId,
      before,
      after,
    });
    return after;
  }

  public updateGuildChannels(
    guildId: string,
    actorUserId: string,
    channels: {
      alertChannelId?: string | null;
      logChannelId?: string | null;
      fallbackReviewChannelId?: string | null;
      supportWorkChannelIds?: string[];
    },
  ): GuildConfigRecord {
    const before = this.getGuildConfigOrThrow(guildId);
    const now = new Date().toISOString();

    const alertCh = channels.alertChannelId !== undefined ? channels.alertChannelId : before.alert_channel_id;
    const logCh = channels.logChannelId !== undefined ? channels.logChannelId : before.log_channel_id;
    const fallbackCh =
      channels.fallbackReviewChannelId !== undefined
        ? channels.fallbackReviewChannelId
        : before.fallback_review_channel_id;
    const supportIdsJson =
      channels.supportWorkChannelIds !== undefined
        ? JSON.stringify(Array.from(new Set(channels.supportWorkChannelIds)))
        : before.support_work_channel_ids_json;

    this.db.run(
      `UPDATE guild_config SET
        alert_channel_id = ?,
        log_channel_id = ?,
        fallback_review_channel_id = ?,
        support_work_channel_ids_json = ?,
        updated_at = ?
      WHERE guild_id = ?`,
      [alertCh, logCh, fallbackCh, supportIdsJson, now, guildId],
    );

    const after = this.getGuildConfigOrThrow(guildId);
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'SETTINGS',
      actionType: 'GUILD_CHANNELS_UPDATED',
      targetType: 'GUILD_CONFIG',
      targetId: guildId,
      before,
      after,
    });
    return after;
  }

  public updateWarningConfig(
    guildId: string,
    actorUserId: string,
    config: {
      warningExpiryDays?: number;
      approvalPolicyOverride?: ApprovalPolicy | null;
    },
  ): GuildConfigRecord {
    const before = this.getGuildConfigOrThrow(guildId);
    const globalCfg = this.getGlobalConfig();

    if (
      config.approvalPolicyOverride !== undefined &&
      config.approvalPolicyOverride !== null &&
      !globalCfg.allow_guild_policy_override &&
      !isPermanentGlobalOwner(actorUserId)
    ) {
      throw new Error('Global Owner policy currently locks approval policies globally.');
    }

    const expiryDays = config.warningExpiryDays ?? before.warning_expiry_days;
    if (expiryDays < 0 || expiryDays > 3650) {
      throw new Error('Warning expiry days must be between 0 (never expire) and 3650.');
    }

    const policyOverride =
      config.approvalPolicyOverride !== undefined ? config.approvalPolicyOverride : before.approval_policy_override;

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE guild_config SET
        warning_expiry_days = ?,
        approval_policy_override = ?,
        updated_at = ?
      WHERE guild_id = ?`,
      [expiryDays, policyOverride, now, guildId],
    );

    const after = this.getGuildConfigOrThrow(guildId);
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'WARNING',
      actionType: 'WARNING_CONFIG_UPDATED',
      targetType: 'GUILD_CONFIG',
      targetId: guildId,
      before,
      after,
    });
    return after;
  }

  public markBaselineCompleted(guildId: string): void {
    const now = new Date().toISOString();
    this.db.run(
      'UPDATE guild_config SET baseline_completed_at = COALESCE(baseline_completed_at, ?), updated_at = ? WHERE guild_id = ?',
      [now, now, guildId],
    );
  }
}
