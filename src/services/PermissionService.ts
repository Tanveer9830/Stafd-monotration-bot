import { IRelationalDatabase } from '../database/connection';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { BotAdminScope, LocalPermissionTier } from '../types/domain';
import { isValidSnowflake } from '../utils/ids';
import { AuditService } from './AuditService';
import { GuildConfigService } from './GuildConfigService';

export interface BotAdminRecord {
  user_id: string;
  username: string;
  added_by: string;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  scopes: BotAdminScope[];
}

export interface GuildPermissionAssignmentRecord {
  id: number;
  guild_id: string;
  target_type: 'USER' | 'ROLE';
  target_id: string;
  permission_level: LocalPermissionTier;
  can_approve_warnings: number;
  can_manage_leave: number;
  can_view_reports: number;
  can_configure_bot: number;
  granted_by: string;
  created_at: string;
}

export interface ActorGuildContext {
  userId: string;
  userTag?: string;
  guildId: string;
  actualGuildOwnerId?: string;
  memberRoleIds?: readonly string[];
}

export interface EvaluatedPermissions {
  isGlobalOwner: boolean;
  isBotAdmin: boolean;
  isServerOwner: boolean;
  isCoOwner: boolean;
  isManagementReviewer: boolean;
  canAccessGlobalPanel: boolean;
  canManageBotAdmins: boolean;
  canConfigureGuild: boolean;
  canApproveWarnings: boolean;
  canManageLeave: boolean;
  canViewReports: boolean;
}

export class PermissionService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, guildConfig: GuildConfigService, audit: AuditService) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.audit = audit;
  }

  /**
   * Sole authoritative Global Owner check.
   * Uses ONLY exact numeric Discord user ID comparison against "1131248987173814336".
   */
  public isGlobalOwner(userId: unknown): boolean {
    return isPermanentGlobalOwner(userId);
  }

  public assertGlobalOwner(userId: string, actionDescription: string, guildId?: string | null): void {
    if (!this.isGlobalOwner(userId)) {
      this.audit.log({
        guildId: guildId ?? null,
        actorUserId: userId,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'GLOBAL_OWNER_CHECK_DENIED',
        metadata: { actionDescription },
      });
      throw new Error('Access Denied: This action is strictly reserved for the Permanent Global Owner.');
    }
  }

  /**
   * Appoints or updates a Bot Administrator. Strictly restricted to the Global Owner.
   * Rejects attempts to appoint the Global Owner ID as a subordinate admin or alter Global Owner status.
   */
  public addBotAdmin(
    actorUserId: string,
    targetUserId: string,
    targetUsername: string,
    scopes: BotAdminScope[] = ['VIEW_GLOBAL_STATS', 'VIEW_GUILDS', 'INSPECT_DIAGNOSTICS'],
    notes?: string,
  ): BotAdminRecord {
    this.assertGlobalOwner(actorUserId, 'ADD_BOT_ADMIN');

    if (!isValidSnowflake(targetUserId)) {
      throw new Error(`Invalid Discord User ID: "${targetUserId}".`);
    }
    if (isPermanentGlobalOwner(targetUserId)) {
      throw new Error('The Permanent Global Owner already holds supreme system authority.');
    }

    const now = new Date().toISOString();
    const uniqueScopes = Array.from(new Set(scopes));

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO bot_admins (user_id, username, added_by, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           username = excluded.username,
           notes = excluded.notes,
           active = 1,
           updated_at = excluded.updated_at`,
        [targetUserId, targetUsername, GLOBAL_OWNER_ID, notes ?? null, now, now],
      );

      this.db.run('DELETE FROM bot_admin_scopes WHERE user_id = ?', [targetUserId]);
      for (const scope of uniqueScopes) {
        this.db.run(
          `INSERT INTO bot_admin_scopes (user_id, scope, guild_id, granted_by, created_at)
           VALUES (?, ?, NULL, ?, ?)`,
          [targetUserId, scope, GLOBAL_OWNER_ID, now],
        );
      }
    });

    const record = this.getBotAdmin(targetUserId)!;
    this.audit.log({
      actorUserId,
      actionCategory: 'OWNER_SECURITY',
      actionType: 'BOT_ADMIN_APPOINTED',
      targetType: 'USER',
      targetId: targetUserId,
      after: record,
    });
    return record;
  }

  public removeBotAdmin(actorUserId: string, targetUserId: string): boolean {
    this.assertGlobalOwner(actorUserId, 'REMOVE_BOT_ADMIN');
    const existing = this.getBotAdmin(targetUserId);
    if (!existing) {
      return false;
    }

    this.db.transaction(() => {
      this.db.run('DELETE FROM bot_admin_scopes WHERE user_id = ?', [targetUserId]);
      this.db.run('DELETE FROM bot_admins WHERE user_id = ?', [targetUserId]);
    });

    this.audit.log({
      actorUserId,
      actionCategory: 'OWNER_SECURITY',
      actionType: 'BOT_ADMIN_REMOVED',
      targetType: 'USER',
      targetId: targetUserId,
      before: existing,
    });
    return true;
  }

  public getBotAdmin(userId: string): BotAdminRecord | null {
    const row = this.db.get<{
      user_id: string;
      username: string;
      added_by: string;
      notes: string | null;
      active: number;
      created_at: string;
      updated_at: string;
    }>('SELECT * FROM bot_admins WHERE user_id = ? AND active = 1', [userId]);
    if (!row) return null;

    const scopes = this.db
      .all<{ scope: BotAdminScope }>('SELECT scope FROM bot_admin_scopes WHERE user_id = ?', [userId])
      .map((s) => s.scope);

    return {
      ...row,
      scopes,
    };
  }

  public listBotAdmins(): BotAdminRecord[] {
    const rows = this.db.all<{ user_id: string }>('SELECT user_id FROM bot_admins WHERE active = 1 ORDER BY created_at ASC');
    return rows.map((r) => this.getBotAdmin(r.user_id)!).filter(Boolean);
  }

  public hasBotAdminScope(userId: string, scope: BotAdminScope): boolean {
    if (this.isGlobalOwner(userId)) return true;
    const admin = this.getBotAdmin(userId);
    return Boolean(admin && admin.scopes.includes(scope));
  }

  /**
   * Configures explicit User ID or Role ID local permissions for a specific guild.
   * Never uses role names or usernames.
   */
  public setGuildPermissionAssignment(
    ctx: ActorGuildContext,
    input: {
      targetType: 'USER' | 'ROLE';
      targetId: string;
      permissionLevel: LocalPermissionTier;
      canApproveWarnings?: boolean;
      canManageLeave?: boolean;
      canViewReports?: boolean;
      canConfigureBot?: boolean;
    },
  ): GuildPermissionAssignmentRecord {
    const perms = this.evaluateGuildPermissions(ctx);
    if (!perms.isGlobalOwner && !perms.isServerOwner) {
      this.audit.log({
        guildId: ctx.guildId,
        actorUserId: ctx.userId,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'GUILD_PERMISSION_ASSIGNMENT_DENIED',
      });
      throw new Error('Forbidden: Only the Discord Server Owner or Global Owner can configure reviewer permissions.');
    }

    if (!isValidSnowflake(input.targetId)) {
      throw new Error(`Invalid Discord ${input.targetType} ID: "${input.targetId}".`);
    }

    const defaultsByTier: Record<
      LocalPermissionTier,
      { approve: boolean; leave: boolean; reports: boolean; config: boolean }
    > = {
      CO_OWNER: { approve: true, leave: true, reports: true, config: true },
      MANAGEMENT_REVIEWER: { approve: true, leave: true, reports: true, config: false },
      LEAVE_MANAGER: { approve: false, leave: true, reports: true, config: false },
      REPORT_VIEWER: { approve: false, leave: false, reports: true, config: false },
    };

    const tierDefault = defaultsByTier[input.permissionLevel];
    const canApprove = (input.canApproveWarnings ?? tierDefault.approve) ? 1 : 0;
    const canLeave = (input.canManageLeave ?? tierDefault.leave) ? 1 : 0;
    const canReports = (input.canViewReports ?? tierDefault.reports) ? 1 : 0;
    const canConfig = (input.canConfigureBot ?? tierDefault.config) ? 1 : 0;
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO guild_permission_assignments (
        guild_id, target_type, target_id, permission_level,
        can_approve_warnings, can_manage_leave, can_view_reports, can_configure_bot,
        granted_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, target_type, target_id) DO UPDATE SET
        permission_level = excluded.permission_level,
        can_approve_warnings = excluded.can_approve_warnings,
        can_manage_leave = excluded.can_manage_leave,
        can_view_reports = excluded.can_view_reports,
        can_configure_bot = excluded.can_configure_bot,
        granted_by = excluded.granted_by`,
      [
        ctx.guildId,
        input.targetType,
        input.targetId,
        input.permissionLevel,
        canApprove,
        canLeave,
        canReports,
        canConfig,
        ctx.userId,
        now,
      ],
    );

    const saved = this.db.get<GuildPermissionAssignmentRecord>(
      'SELECT * FROM guild_permission_assignments WHERE guild_id = ? AND target_type = ? AND target_id = ?',
      [ctx.guildId, input.targetType, input.targetId],
    )!;

    this.audit.log({
      guildId: ctx.guildId,
      actorUserId: ctx.userId,
      actorTag: ctx.userTag,
      actionCategory: 'PERMISSIONS',
      actionType: 'GUILD_PERMISSION_ASSIGNED',
      targetType: input.targetType,
      targetId: input.targetId,
      after: saved,
    });

    return saved;
  }

  public removeGuildPermissionAssignment(
    ctx: ActorGuildContext,
    targetType: 'USER' | 'ROLE',
    targetId: string,
  ): boolean {
    const perms = this.evaluateGuildPermissions(ctx);
    if (!perms.isGlobalOwner && !perms.isServerOwner) {
      throw new Error('Forbidden: Only the Discord Server Owner or Global Owner can remove reviewer permissions.');
    }

    const before = this.db.get<GuildPermissionAssignmentRecord>(
      'SELECT * FROM guild_permission_assignments WHERE guild_id = ? AND target_type = ? AND target_id = ?',
      [ctx.guildId, targetType, targetId],
    );
    if (!before) return false;

    this.db.run(
      'DELETE FROM guild_permission_assignments WHERE guild_id = ? AND target_type = ? AND target_id = ?',
      [ctx.guildId, targetType, targetId],
    );

    this.audit.log({
      guildId: ctx.guildId,
      actorUserId: ctx.userId,
      actorTag: ctx.userTag,
      actionCategory: 'PERMISSIONS',
      actionType: 'GUILD_PERMISSION_REMOVED',
      targetType,
      targetId,
      before,
    });
    return true;
  }

  public listGuildPermissionAssignments(guildId: string): GuildPermissionAssignmentRecord[] {
    return this.db.all<GuildPermissionAssignmentRecord>(
      'SELECT * FROM guild_permission_assignments WHERE guild_id = ? ORDER BY created_at ASC',
      [guildId],
    );
  }

  /**
   * Evaluates complete server-side permissions for a user inside a specific guild.
   * Automatically synchronizes server ownership changes when `actualGuildOwnerId` is supplied.
   */
  public evaluateGuildPermissions(ctx: ActorGuildContext): EvaluatedPermissions {
    const globalOwner = this.isGlobalOwner(ctx.userId);
    const botAdmin = this.getBotAdmin(ctx.userId);

    const storedGuild = this.guildConfig.getGuildConfig(ctx.guildId);
    let effectiveOwnerId = storedGuild?.owner_id;

    if (ctx.actualGuildOwnerId && storedGuild && storedGuild.owner_id !== ctx.actualGuildOwnerId) {
      const updated = this.guildConfig.ensureGuildRegistered(
        ctx.guildId,
        storedGuild.guild_name,
        ctx.actualGuildOwnerId,
      );
      effectiveOwnerId = updated.owner_id;
    } else if (ctx.actualGuildOwnerId && !storedGuild) {
      effectiveOwnerId = ctx.actualGuildOwnerId;
    }

    const isServerOwner = Boolean(effectiveOwnerId && ctx.userId === effectiveOwnerId);

    const assignments = this.listGuildPermissionAssignments(ctx.guildId);
    const roleSet = new Set(ctx.memberRoleIds ?? []);

    const matchingAssignments = assignments.filter(
      (a) =>
        (a.target_type === 'USER' && a.target_id === ctx.userId) ||
        (a.target_type === 'ROLE' && roleSet.has(a.target_id)),
    );

    const isCoOwner = matchingAssignments.some((a) => a.permission_level === 'CO_OWNER');
    const isManagementReviewer = matchingAssignments.some(
      (a) => a.permission_level === 'MANAGEMENT_REVIEWER' || a.can_approve_warnings === 1,
    );

    // Website Access & Roles assignments are honored by the review/warning engines too.
    const webRows = this.db.all<{ role: string; permissions_json: string }>(
      `SELECT role, permissions_json FROM web_role_assignments
       WHERE user_id = ? AND guild_id = ? AND status = 'ACTIVE'
         AND (expires_at IS NULL OR expires_at > ?)`,
      [ctx.userId, ctx.guildId, new Date().toISOString()],
    );
    let webScopes: string[] = [];
    for (const row of webRows) {
      try {
        webScopes = webScopes.concat(JSON.parse(row.permissions_json) as string[]);
      } catch {
        // ignore malformed stored scopes
      }
    }
    const webApprove = webScopes.includes('SERVER_MANAGE_REVIEWS') || webScopes.includes('SERVER_MANAGE_WARNINGS');
    const webLeave = webScopes.includes('SERVER_MANAGE_LEAVE');
    const webReports = webScopes.includes('SERVER_VIEW_ANALYTICS') || webScopes.includes('SERVER_VIEW_OVERVIEW');
    const webConfigure = webScopes.includes('SERVER_MANAGE_SETTINGS');
    const isWebCoOwner = webRows.some((r) => r.role === 'SERVER_CO_OWNER');

    const assignedConfigure = matchingAssignments.some((a) => a.can_configure_bot === 1) || webConfigure;
    const assignedApprove = matchingAssignments.some((a) => a.can_approve_warnings === 1) || webApprove;
    const assignedLeave = matchingAssignments.some((a) => a.can_manage_leave === 1) || webLeave;
    const assignedReports = matchingAssignments.some((a) => a.can_view_reports === 1) || webReports;

    const botAdminCanInspect = Boolean(botAdmin?.scopes.includes('INSPECT_DIAGNOSTICS'));
    const botAdminCanReview = Boolean(botAdmin?.scopes.includes('REVIEW_CASES'));

    return {
      isGlobalOwner: globalOwner,
      isBotAdmin: Boolean(botAdmin),
      isServerOwner,
      isCoOwner: isCoOwner || isWebCoOwner,
      isManagementReviewer,
      canAccessGlobalPanel: globalOwner,
      canManageBotAdmins: globalOwner,
      canConfigureGuild: globalOwner || isServerOwner || assignedConfigure,
      canApproveWarnings: globalOwner || isServerOwner || assignedApprove || botAdminCanReview,
      canManageLeave: globalOwner || isServerOwner || assignedLeave,
      canViewReports: globalOwner || isServerOwner || assignedReports || botAdminCanInspect,
    };
  }

  public assertGuildCapability(
    ctx: ActorGuildContext,
    capability: 'canConfigureGuild' | 'canApproveWarnings' | 'canManageLeave' | 'canViewReports',
    actionDescription: string,
  ): EvaluatedPermissions {
    const perms = this.evaluateGuildPermissions(ctx);
    if (!perms[capability]) {
      this.audit.log({
        guildId: ctx.guildId,
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'CAPABILITY_DENIED',
        metadata: { capability, actionDescription },
      });
      throw new Error(`Access Denied: You do not have permission to perform "${actionDescription}" in this server.`);
    }
    return perms;
  }

  /**
   * Resolves the deduplicated list of Discord User IDs that MUST receive an inactivity
   * warning review notification for `guildId`:
   *   1. Permanent Global Owner ("1131248987173814336") — ALWAYS included regardless of local roles!
   *   2. Actual Discord Server Owner (`guild_config.owner_id`)
   *   3. Explicitly configured authorized Co-Owners (User IDs + members holding configured Role IDs)
   *   4. Explicitly configured Management Reviewers (User IDs + members holding configured Role IDs)
   */
  public resolveDeduplicatedReviewRecipients(
    guildId: string,
    roleHoldersMap: ReadonlyMap<string, readonly string[]> = new Map(),
  ): string[] {
    const recipients = new Set<string>();

    // 1. Permanent Global Owner ALWAYS receives inactivity approval requests across every server
    recipients.add(GLOBAL_OWNER_ID);

    // 2. Actual Discord Server Owner
    const guildCfg = this.guildConfig.getGuildConfig(guildId);
    if (guildCfg?.owner_id && isValidSnowflake(guildCfg.owner_id)) {
      recipients.add(guildCfg.owner_id);
    }

    // 3 & 4. Configured Co-Owners and Management Reviewers (exact User IDs & Role IDs)
    const assignments = this.listGuildPermissionAssignments(guildId).filter(
      (a) =>
        a.permission_level === 'CO_OWNER' ||
        a.permission_level === 'MANAGEMENT_REVIEWER' ||
        a.can_approve_warnings === 1,
    );

    for (const assignment of assignments) {
      if (assignment.target_type === 'USER' && isValidSnowflake(assignment.target_id)) {
        recipients.add(assignment.target_id);
      } else if (assignment.target_type === 'ROLE') {
        const membersWithRole = roleHoldersMap.get(assignment.target_id) ?? [];
        for (const memberId of membersWithRole) {
          if (isValidSnowflake(memberId)) {
            recipients.add(memberId);
          }
        }
      }
    }

    return Array.from(recipients);
  }
}
