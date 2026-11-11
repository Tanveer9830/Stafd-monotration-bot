import { IRelationalDatabase } from '../database/connection';
import { StaffMonitoringStatus } from '../config/theme';
import {
  StaffProfileRecord,
  StaffRoleCategory,
  StaffRoleRecord,
} from '../types/domain';
import { isValidSnowflake } from '../utils/ids';
import { AuditService } from './AuditService';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';

export interface GuildMemberSnapshot {
  userId: string;
  username: string;
  displayName: string;
  roleIds: string[];
  presenceStatus?: string | null;
  isBot?: boolean;
}

export interface RosterSyncResult {
  totalConfiguredRoles: number;
  activeStaffCount: number;
  newlyRegistered: string[];
  rejoinedStaff: string[];
  removedFromStaff: string[];
  leftGuildStaff: string[];
}

const CATEGORY_PRIORITY: Readonly<Record<StaffRoleCategory, number>> = Object.freeze({
  CO_OWNER: 120,
  MANAGEMENT: 110,
  ADMINISTRATOR: 100,
  SENIOR_MODERATOR: 90,
  MODERATOR: 80,
  SENIOR_STAFF: 70,
  STAFF: 60,
  SUPPORT_TEAM: 50,
  HELPER: 40,
  JUNIOR_STAFF: 30,
  TRIAL_STAFF: 20,
  CUSTOM: 10,
});

export class RosterService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly audit: AuditService;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    audit: AuditService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.audit = audit;
  }

  public addOrUpdateStaffRole(
    guildId: string,
    actorUserId: string,
    input: {
      roleId: string;
      roleName: string;
      category: StaffRoleCategory;
      customAtRiskHours?: number | null;
      customInactiveHours?: number | null;
      customEscalationHours?: number | null;
      isMonitored?: boolean;
    },
  ): StaffRoleRecord {
    this.guildConfig.getGuildConfigOrThrow(guildId);
    if (!isValidSnowflake(input.roleId)) {
      throw new Error(`Invalid Discord Role ID: "${input.roleId}".`);
    }

    const globalCfg = this.guildConfig.getGlobalConfig();
    if (input.customAtRiskHours != null) {
      if (
        input.customAtRiskHours < globalCfg.min_at_risk_hours ||
        input.customAtRiskHours > globalCfg.max_at_risk_hours
      ) {
        throw new Error(
          `Role at-risk hours (${input.customAtRiskHours}h) outside global bounds (${globalCfg.min_at_risk_hours}h–${globalCfg.max_at_risk_hours}h).`,
        );
      }
    }
    if (input.customInactiveHours != null) {
      if (
        input.customInactiveHours < globalCfg.min_inactive_hours ||
        input.customInactiveHours > globalCfg.max_inactive_hours
      ) {
        throw new Error(
          `Role inactive hours (${input.customInactiveHours}h) outside global bounds (${globalCfg.min_inactive_hours}h–${globalCfg.max_inactive_hours}h).`,
        );
      }
    }
    if (input.customEscalationHours != null) {
      if (
        input.customEscalationHours < globalCfg.min_escalation_hours ||
        input.customEscalationHours > globalCfg.max_escalation_hours
      ) {
        throw new Error(
          `Role escalation hours (${input.customEscalationHours}h) outside global bounds (${globalCfg.min_escalation_hours}h–${globalCfg.max_escalation_hours}h).`,
        );
      }
    }

    const now = new Date().toISOString();
    const monitored = input.isMonitored === false ? 0 : 1;

    this.db.run(
      `INSERT INTO staff_roles (
        guild_id, role_id, role_name, category,
        custom_at_risk_hours, custom_inactive_hours, custom_escalation_hours,
        is_monitored, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, role_id) DO UPDATE SET
        role_name = excluded.role_name,
        category = excluded.category,
        custom_at_risk_hours = COALESCE(excluded.custom_at_risk_hours, staff_roles.custom_at_risk_hours),
        custom_inactive_hours = COALESCE(excluded.custom_inactive_hours, staff_roles.custom_inactive_hours),
        custom_escalation_hours = COALESCE(excluded.custom_escalation_hours, staff_roles.custom_escalation_hours),
        is_monitored = excluded.is_monitored`,
      [
        guildId,
        input.roleId,
        input.roleName,
        input.category,
        input.customAtRiskHours ?? null,
        input.customInactiveHours ?? null,
        input.customEscalationHours ?? null,
        monitored,
        actorUserId,
        now,
      ],
    );

    const saved = this.db.get<StaffRoleRecord>(
      'SELECT * FROM staff_roles WHERE guild_id = ? AND role_id = ?',
      [guildId, input.roleId],
    )!;

    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'ROSTER',
      actionType: 'STAFF_ROLE_CONFIGURED',
      targetType: 'ROLE',
      targetId: input.roleId,
      after: saved,
    });

    return saved;
  }

  public removeStaffRole(guildId: string, actorUserId: string, roleId: string): boolean {
    const existing = this.db.get<StaffRoleRecord>(
      'SELECT * FROM staff_roles WHERE guild_id = ? AND role_id = ?',
      [guildId, roleId],
    );
    if (!existing) return false;

    this.db.run('DELETE FROM staff_roles WHERE guild_id = ? AND role_id = ?', [guildId, roleId]);

    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'ROSTER',
      actionType: 'STAFF_ROLE_REMOVED',
      targetType: 'ROLE',
      targetId: roleId,
      before: existing,
    });
    return true;
  }

  public listStaffRoles(guildId: string, onlyMonitored = false): StaffRoleRecord[] {
    if (onlyMonitored) {
      return this.db.all<StaffRoleRecord>(
        'SELECT * FROM staff_roles WHERE guild_id = ? AND is_monitored = 1 ORDER BY id ASC',
        [guildId],
      );
    }
    return this.db.all<StaffRoleRecord>('SELECT * FROM staff_roles WHERE guild_id = ? ORDER BY id ASC', [
      guildId,
    ]);
  }

  private pickPrimaryCategory(matchingRoles: StaffRoleRecord[]): StaffRoleCategory {
    if (matchingRoles.length === 0) return 'STAFF';
    return [...matchingRoles].sort(
      (a, b) => (CATEGORY_PRIORITY[b.category] ?? 0) - (CATEGORY_PRIORITY[a.category] ?? 0),
    )[0].category;
  }

  /**
   * Synchronizes the complete configured staff roster for a guild.
   * Preserves historical profiles when members lose staff roles or leave the guild.
   */
  public syncGuildRoster(
    guildId: string,
    members: readonly GuildMemberSnapshot[],
    options?: { forceEvenIfDisabled?: boolean; nowIso?: string },
  ): RosterSyncResult {
    this.guildConfig.getGuildConfigOrThrow(guildId);
    if (!options?.forceEvenIfDisabled && !this.features.isEnabled(guildId, 'roster_sync')) {
      const roles = this.listStaffRoles(guildId, true);
      const active = this.listStaffProfiles(guildId, { onlyActiveStaff: true });
      return {
        totalConfiguredRoles: roles.length,
        activeStaffCount: active.length,
        newlyRegistered: [],
        rejoinedStaff: [],
        removedFromStaff: [],
        leftGuildStaff: [],
      };
    }

    const monitoredRoles = this.listStaffRoles(guildId, true);
    const monitoredRoleMap = new Map<string, StaffRoleRecord>(monitoredRoles.map((r) => [r.role_id, r]));
    const presenceEnabled = this.features.isEnabled(guildId, 'presence_monitoring');
    const now = options?.nowIso ?? new Date().toISOString();

    const existingProfiles = new Map<string, StaffProfileRecord>(
      this.db
        .all<StaffProfileRecord>('SELECT * FROM staff_profiles WHERE guild_id = ?', [guildId])
        .map((p) => [p.user_id, p]),
    );

    const seenGuildMemberIds = new Set<string>();
    const newlyRegistered: string[] = [];
    const rejoinedStaff: string[] = [];
    const removedFromStaff: string[] = [];
    const leftGuildStaff: string[] = [];

    this.db.transaction(() => {
      for (const member of members) {
        if (member.isBot) continue;
        seenGuildMemberIds.add(member.userId);

        const heldStaffRoles = member.roleIds
          .map((rid) => monitoredRoleMap.get(rid))
          .filter((r): r is StaffRoleRecord => r !== undefined);

        const existing = existingProfiles.get(member.userId);
        const heldIds = heldStaffRoles.map((r) => r.role_id).sort();
        const heldIdsJson = JSON.stringify(heldIds);
        const presenceVal = presenceEnabled ? (member.presenceStatus ?? null) : null;

        if (heldStaffRoles.length > 0) {
          const primaryCategory = this.pickPrimaryCategory(heldStaffRoles);

          if (!existing) {
            this.db.run(
              `INSERT INTO staff_profiles (
                guild_id, user_id, username, display_name, active_role_ids_json, primary_category,
                first_registered_at, joined_staff_at, is_currently_staff, monitoring_status,
                monitoring_coverage, presence_status, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'NEW_STAFF', 'UNAVAILABLE', ?, ?)`,
              [
                guildId,
                member.userId,
                member.username,
                member.displayName,
                heldIdsJson,
                primaryCategory,
                now,
                now,
                presenceVal,
                now,
              ],
            );
            this.db.run(
              `INSERT INTO staff_role_history (
                guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
              ) VALUES (?, ?, 'ADDED', '[]', ?, ?)`,
              [guildId, member.userId, heldIdsJson, now],
            );
            newlyRegistered.push(member.userId);
          } else {
            const wasInactiveStaff = existing.is_currently_staff === 0;
            const prevRolesJson = existing.active_role_ids_json;

            this.db.run(
              `UPDATE staff_profiles SET
                username = ?,
                display_name = ?,
                active_role_ids_json = ?,
                primary_category = ?,
                joined_staff_at = CASE WHEN is_currently_staff = 0 THEN ? ELSE joined_staff_at END,
                left_guild_at = NULL,
                role_removed_at = NULL,
                is_currently_staff = 1,
                monitoring_status = CASE WHEN is_currently_staff = 0 THEN 'NEW_STAFF' ELSE monitoring_status END,
                presence_status = ?,
                updated_at = ?
              WHERE guild_id = ? AND user_id = ?`,
              [
                member.username,
                member.displayName,
                heldIdsJson,
                primaryCategory,
                now,
                presenceVal,
                now,
                guildId,
                member.userId,
              ],
            );

            if (wasInactiveStaff) {
              this.db.run(
                `INSERT INTO staff_role_history (
                  guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
                ) VALUES (?, ?, 'REJOINED_GUILD', ?, ?, ?)`,
                [guildId, member.userId, prevRolesJson, heldIdsJson, now],
              );
              rejoinedStaff.push(member.userId);
            } else if (prevRolesJson !== heldIdsJson) {
              this.db.run(
                `INSERT INTO staff_role_history (
                  guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
                ) VALUES (?, ?, 'SYNCED', ?, ?, ?)`,
                [guildId, member.userId, prevRolesJson, heldIdsJson, now],
              );
            }
          }
        } else if (existing && existing.is_currently_staff === 1) {
          // Member is still in guild, but no longer holds any configured staff role.
          // Preserve all historical records without erasing profile!
          this.db.run(
            `UPDATE staff_profiles SET
              username = ?,
              display_name = ?,
              active_role_ids_json = '[]',
              role_removed_at = ?,
              is_currently_staff = 0,
              updated_at = ?
            WHERE guild_id = ? AND user_id = ?`,
            [member.username, member.displayName, now, now, guildId, member.userId],
          );
          this.db.run(
            `INSERT INTO staff_role_history (
              guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
            ) VALUES (?, ?, 'REMOVED', ?, '[]', ?)`,
            [guildId, member.userId, existing.active_role_ids_json, now],
          );
          removedFromStaff.push(member.userId);
        }
      }

      // Check previously active staff who left the Discord server entirely
      for (const [userId, profile] of existingProfiles.entries()) {
        if (profile.is_currently_staff === 1 && !seenGuildMemberIds.has(userId)) {
          this.db.run(
            `UPDATE staff_profiles SET
              active_role_ids_json = '[]',
              left_guild_at = ?,
              is_currently_staff = 0,
              updated_at = ?
            WHERE guild_id = ? AND user_id = ?`,
            [now, now, guildId, userId],
          );
          this.db.run(
            `INSERT INTO staff_role_history (
              guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
            ) VALUES (?, ?, 'LEFT_GUILD', ?, '[]', ?)`,
            [guildId, userId, profile.active_role_ids_json, now],
          );
          leftGuildStaff.push(userId);
        }
      }
    });

    const activeProfiles = this.listStaffProfiles(guildId, { onlyActiveStaff: true });
    return {
      totalConfiguredRoles: monitoredRoles.length,
      activeStaffCount: activeProfiles.length,
      newlyRegistered,
      rejoinedStaff,
      removedFromStaff,
      leftGuildStaff,
    };
  }

  public handleMemberLeave(guildId: string, userId: string, nowIso = new Date().toISOString()): void {
    const existing = this.getStaffProfile(guildId, userId);
    if (!existing || existing.is_currently_staff === 0) return;

    this.db.transaction(() => {
      this.db.run(
        `UPDATE staff_profiles SET
          active_role_ids_json = '[]',
          left_guild_at = ?,
          is_currently_staff = 0,
          updated_at = ?
        WHERE guild_id = ? AND user_id = ?`,
        [nowIso, nowIso, guildId, userId],
      );
      this.db.run(
        `INSERT INTO staff_role_history (
          guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
        ) VALUES (?, ?, 'LEFT_GUILD', ?, '[]', ?)`,
        [guildId, userId, existing.active_role_ids_json, nowIso],
      );
    });
  }

  public getStaffProfile(guildId: string, userId: string): StaffProfileRecord | undefined {
    return this.db.get<StaffProfileRecord>(
      'SELECT * FROM staff_profiles WHERE guild_id = ? AND user_id = ?',
      [guildId, userId],
    );
  }

  public listStaffProfiles(
    guildId: string,
    options?: {
      onlyActiveStaff?: boolean;
      status?: StaffMonitoringStatus;
      limit?: number;
      offset?: number;
    },
  ): StaffProfileRecord[] {
    const clauses = ['guild_id = ?'];
    const params: unknown[] = [guildId];

    if (options?.onlyActiveStaff !== false) {
      clauses.push('is_currently_staff = 1');
    }
    if (options?.status) {
      clauses.push('monitoring_status = ?');
      params.push(options.status);
    }

    let sql = `SELECT * FROM staff_profiles WHERE ${clauses.join(' AND ')} ORDER BY username ASC`;
    if (options?.limit !== undefined) {
      sql += ' LIMIT ? OFFSET ?';
      params.push(options.limit, options.offset ?? 0);
    }

    return this.db.all<StaffProfileRecord>(sql, params);
  }

  public getRoleHistory(guildId: string, userId: string, limit = 25): Array<{
    id: number;
    change_type: string;
    previous_roles_json: string;
    new_roles_json: string;
    detected_at: string;
  }> {
    return this.db.all(
      `SELECT id, change_type, previous_roles_json, new_roles_json, detected_at
       FROM staff_role_history
       WHERE guild_id = ? AND user_id = ?
       ORDER BY detected_at DESC LIMIT ?`,
      [guildId, userId, limit],
    );
  }

  /**
   * Resolves effective inactivity thresholds for a staff member, respecting any
   * role-specific overrides configured on their active staff roles.
   */
  public resolveThresholdsForStaff(guildId: string, profile: StaffProfileRecord): {
    atRiskHours: number;
    inactiveHours: number;
    escalationHours: number;
  } {
    const guildCfg = this.guildConfig.getGuildConfigOrThrow(guildId);
    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(profile.active_role_ids_json) as string[];
    } catch {
      roleIds = [];
    }

    if (roleIds.length === 0) {
      return {
        atRiskHours: guildCfg.at_risk_hours,
        inactiveHours: guildCfg.inactive_hours,
        escalationHours: guildCfg.escalation_hours,
      };
    }

    const roles = this.listStaffRoles(guildId, true).filter((r) => roleIds.includes(r.role_id));
    const customAtRisk = roles
      .map((r) => r.custom_at_risk_hours)
      .filter((v): v is number => v !== null && v > 0);
    const customInactive = roles
      .map((r) => r.custom_inactive_hours)
      .filter((v): v is number => v !== null && v > 0);
    const customEscalation = roles
      .map((r) => r.custom_escalation_hours)
      .filter((v): v is number => v !== null && v > 0);

    const atRiskHours = customAtRisk.length > 0 ? Math.max(...customAtRisk) : guildCfg.at_risk_hours;
    const inactiveHours =
      customInactive.length > 0 ? Math.max(atRiskHours, Math.max(...customInactive)) : Math.max(atRiskHours, guildCfg.inactive_hours);
    const escalationHours =
      customEscalation.length > 0
        ? Math.max(inactiveHours, Math.max(...customEscalation))
        : Math.max(inactiveHours, guildCfg.escalation_hours);

    return { atRiskHours, inactiveHours, escalationHours };
  }

  public isActiveStaffMember(guildId: string, userId: string): boolean {
    const row = this.db.get<{ is_currently_staff: number }>(
      'SELECT is_currently_staff FROM staff_profiles WHERE guild_id = ? AND user_id = ?',
      [guildId, userId],
    );
    return row?.is_currently_staff === 1;
  }
}
