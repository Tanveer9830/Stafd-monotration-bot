import { IRelationalDatabase } from '../database/connection';
import { StaffRoleCategory, StaffRoleRecord } from '../types/domain';
import { generateEntityId, isValidSnowflake } from '../utils/ids';
import { AuditService } from './AuditService';
import { GuildConfigService } from './GuildConfigService';
import { GuildMemberSnapshot, RosterService } from './RosterService';

export interface DiscoveryRoleSelection {
  roleId: string;
  roleName: string;
}

export interface DiscoveryReport {
  scanId: string;
  rolesSelected: DiscoveryRoleSelection[];
  membersScanned: number;
  staffDiscovered: number;
  newlyRegistered: number;
  existingProfiles: number;
  multiRoleMembers: number;
  unmatchedRoles: string[];
  errors: string[];
  coverageLevel: 'FULL' | 'PARTIAL' | 'UNAVAILABLE';
}

export interface ScanHistoryRecord {
  scan_id: string;
  guild_id: string;
  scan_type: string;
  trigger_source: string;
  actor_user_id: string | null;
  roles_selected_json: string;
  members_scanned: number;
  staff_discovered: number;
  newly_registered: number;
  existing_profiles: number;
  multi_role_members: number;
  unmatched_roles_json: string;
  errors_json: string;
  coverage_level: string;
  started_at: string;
  completed_at: string;
}

/**
 * Additive role-based staff discovery. Unlike a full roster sync, discovering
 * staff from newly selected roles never deactivates unrelated existing staff.
 */
export class StaffDiscoveryService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly roster: RosterService;
  private readonly audit: AuditService;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    roster: RosterService,
    audit: AuditService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.roster = roster;
    this.audit = audit;
  }

  public registerSelectedRoles(
    guildId: string,
    actorUserId: string,
    roles: readonly DiscoveryRoleSelection[],
    category: StaffRoleCategory = 'STAFF',
  ): { added: StaffRoleRecord[]; duplicateCount: number } {
    this.guildConfig.getGuildConfigOrThrow(guildId);
    const added: StaffRoleRecord[] = [];
    let duplicateCount = 0;
    const existing = new Set(this.roster.listStaffRoles(guildId).map((r) => r.role_id));
    for (const role of roles) {
      if (!isValidSnowflake(role.roleId)) continue;
      if (existing.has(role.roleId)) {
        duplicateCount += 1;
        continue;
      }
      added.push(
        this.roster.addOrUpdateStaffRole(guildId, actorUserId, {
          roleId: role.roleId,
          roleName: role.roleName,
          category,
        }),
      );
    }
    return { added, duplicateCount };
  }

  public discoverMembers(
    guildId: string,
    actorUserId: string,
    roles: readonly DiscoveryRoleSelection[],
    members: readonly GuildMemberSnapshot[],
    options: {
      coverageLevel?: 'FULL' | 'PARTIAL' | 'UNAVAILABLE';
      errors?: string[];
      fetchWarning?: string | null;
      nowIso?: string;
    } = {},
  ): DiscoveryReport {
    this.guildConfig.getGuildConfigOrThrow(guildId);
    const startedAt = new Date().toISOString();
    const now = options.nowIso ?? new Date().toISOString();
    const selected = new Map(roles.map((r) => [r.roleId, r.roleName]));
    const errors = [...(options.errors ?? [])];
    if (options.fetchWarning) errors.push(options.fetchWarning);

    const configuredRoles = new Map(this.roster.listStaffRoles(guildId).map((r) => [r.role_id, r]));
    const unmatchedRoles = [...selected.keys()].filter((roleId) => !configuredRoles.has(roleId));

    const matching = members.filter((m) => !m.isBot && m.roleIds.some((rid) => selected.has(rid)));
    const uniqueByUser = new Map<string, GuildMemberSnapshot>();
    for (const member of matching) uniqueByUser.set(member.userId, member);

    let newlyRegistered = 0;
    let existingProfiles = 0;
    let multiRoleMembers = 0;

    this.db.transaction(() => {
      for (const member of uniqueByUser.values()) {
        const heldRoles = member.roleIds.filter((rid) => selected.has(rid));
        if (heldRoles.length > 1) multiRoleMembers += 1;
        const primary =
          heldRoles
            .map((rid) => configuredRoles.get(rid))
            .filter((r): r is StaffRoleRecord => Boolean(r))
            .sort((a, b) => b.category.localeCompare(a.category))[0]?.category ?? 'STAFF';
        const rolesJson = JSON.stringify([...heldRoles].sort());
        const profile = this.roster.getStaffProfile(guildId, member.userId);

        if (!profile) {
          this.db.run(
            `INSERT INTO staff_profiles (
              guild_id, user_id, username, display_name, active_role_ids_json, primary_category,
              first_registered_at, joined_staff_at, is_currently_staff, monitoring_status,
              monitoring_coverage, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'NEW_STAFF', ?, ?)`,
            [
              guildId,
              member.userId,
              member.username,
              member.displayName,
              rolesJson,
              primary,
              now,
              now,
              options.coverageLevel ?? 'PARTIAL',
              now,
            ],
          );
          this.db.run(
            `INSERT INTO staff_role_history (
              guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
            ) VALUES (?, ?, 'ADDED', '[]', ?, ?)`,
            [guildId, member.userId, rolesJson, now],
          );
          newlyRegistered += 1;
        } else {
          existingProfiles += 1;
          const wasInactive = profile.is_currently_staff === 0;
          this.db.run(
            `UPDATE staff_profiles SET
              username = ?, display_name = ?, active_role_ids_json = ?,
              primary_category = ?, is_currently_staff = 1, left_guild_at = NULL,
              role_removed_at = NULL,
              monitoring_status = CASE WHEN is_currently_staff = 0 THEN 'NEW_STAFF' ELSE monitoring_status END,
              updated_at = ?
             WHERE guild_id = ? AND user_id = ?`,
            [member.username, member.displayName, rolesJson, primary, now, guildId, member.userId],
          );
          if (wasInactive) {
            this.db.run(
              `INSERT INTO staff_role_history (
                guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
              ) VALUES (?, ?, 'REJOINED_GUILD', ?, ?, ?)`,
              [guildId, member.userId, profile.active_role_ids_json, rolesJson, now],
            );
          } else if (profile.active_role_ids_json !== rolesJson) {
            this.db.run(
              `INSERT INTO staff_role_history (
                guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at
              ) VALUES (?, ?, 'SYNCED', ?, ?, ?)`,
              [guildId, member.userId, profile.active_role_ids_json, rolesJson, now],
            );
          }
        }
      }
    });

    const completedAt = new Date().toISOString();
    const scanId = generateEntityId('SCN');
    this.db.run(
      `INSERT INTO scan_history (
        scan_id, guild_id, scan_type, trigger_source, actor_user_id, roles_selected_json,
        members_scanned, staff_discovered, newly_registered, existing_profiles, multi_role_members,
        unmatched_roles_json, errors_json, coverage_level, started_at, completed_at
      ) VALUES (?, ?, 'ROLE_DISCOVERY', 'ROLE_DISCOVERY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        guildId,
        actorUserId,
        JSON.stringify([...selected.keys()]),
        members.length,
        uniqueByUser.size,
        newlyRegistered,
        existingProfiles,
        multiRoleMembers,
        JSON.stringify(unmatchedRoles),
        JSON.stringify(errors),
        options.coverageLevel ?? 'PARTIAL',
        startedAt,
        completedAt,
      ],
    );

    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'ROSTER',
      actionType: 'STAFF_ROLE_DISCOVERY_SCAN',
      metadata: {
        scanId,
        roles: [...selected.keys()],
        membersScanned: members.length,
        staffDiscovered: uniqueByUser.size,
        newlyRegistered,
      },
    });

    return {
      scanId,
      rolesSelected: roles.map((r) => ({ ...r })),
      membersScanned: members.length,
      staffDiscovered: uniqueByUser.size,
      newlyRegistered,
      existingProfiles,
      multiRoleMembers,
      unmatchedRoles,
      errors,
      coverageLevel: options.coverageLevel ?? 'PARTIAL',
    };
  }

  public recordScan(input: {
    guildId: string;
    scanType: 'STAFF' | 'TICKETS' | 'FULL' | 'ROLES' | 'SYSTEM';
    trigger: 'MANUAL' | 'SCHEDULED' | 'ROLE_DISCOVERY' | 'STARTUP';
    actorUserId: string | null;
    rolesSelected?: readonly string[];
    membersScanned?: number;
    staffDiscovered?: number;
    newlyRegistered?: number;
    existingProfiles?: number;
    multiRoleMembers?: number;
    unmatchedRoles?: readonly string[];
    errors?: readonly string[];
    coverageLevel?: 'FULL' | 'PARTIAL' | 'UNAVAILABLE';
    startedAt?: string;
    completedAt?: string;
  }): string {
    const scanId = generateEntityId('SCN');
    this.db.run(
      `INSERT INTO scan_history (
        scan_id, guild_id, scan_type, trigger_source, actor_user_id, roles_selected_json,
        members_scanned, staff_discovered, newly_registered, existing_profiles, multi_role_members,
        unmatched_roles_json, errors_json, coverage_level, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scanId,
        input.guildId,
        input.scanType,
        input.trigger,
        input.actorUserId,
        JSON.stringify(input.rolesSelected ?? []),
        input.membersScanned ?? 0,
        input.staffDiscovered ?? 0,
        input.newlyRegistered ?? 0,
        input.existingProfiles ?? 0,
        input.multiRoleMembers ?? 0,
        JSON.stringify(input.unmatchedRoles ?? []),
        JSON.stringify(input.errors ?? []),
        input.coverageLevel ?? 'UNAVAILABLE',
        input.startedAt ?? new Date().toISOString(),
        input.completedAt ?? new Date().toISOString(),
      ],
    );
    return scanId;
  }

  public listScanHistory(guildId: string, limit = 25): ScanHistoryRecord[] {
    return this.db.all<ScanHistoryRecord>(
      'SELECT * FROM scan_history WHERE guild_id = ? ORDER BY started_at DESC LIMIT ?',
      [guildId, limit],
    );
  }
}
