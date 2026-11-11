import { IRelationalDatabase } from '../database/connection';
import { isPermanentGlobalOwner } from '../config/branding';
import {
  GLOBAL_SCOPES,
  GlobalScope,
  LOCAL_SCOPES,
  LocalScope,
  OWNER_LOCAL_SCOPES,
  ROLE_DEFAULT_SCOPES,
  WebRole,
  WebScope,
  isGlobalScope,
  sanitizeScopes,
} from '../types/access';
import { AuditService } from './AuditService';
import { GuildConfigService } from './GuildConfigService';
import { ActorRoleKind, RoleActor, WebRoleAssignmentView, WebRoleService } from './WebRoleService';

export interface DiscordOwnershipProvider {
  /** Returns the current Discord guild owner ID, or null when the guild/bot is unavailable. */
  getGuildOwnerId(guildId: string): Promise<string | null>;
}

export interface GuildAccess {
  userId: string;
  guildId: string;
  guildName: string;
  isGlobalOwner: boolean;
  isServerOwner: boolean;
  ownershipVerified: boolean;
  globalScopes: Set<GlobalScope>;
  localScopes: Set<LocalScope>;
  roles: WebRole[];
  actorKind: ActorRoleKind;
  assignments: WebRoleAssignmentView[];
  isActiveStaff: boolean;
}

export interface UserAccessSummary {
  userId: string;
  isGlobalOwner: boolean;
  globalScopes: GlobalScope[];
  assignments: WebRoleAssignmentView[];
  guilds: Array<{
    guild_id: string;
    guild_name: string;
    role: ActorRoleKind;
    is_owner: boolean;
    is_staff: boolean;
    scopes: LocalScope[];
  }>;
}

interface LegacyPermissionRow {
  permission_level: string;
  target_type: string;
  target_id: string;
  can_approve_warnings: number;
  can_manage_leave: number;
  can_view_reports: number;
  can_configure_bot: number;
}

export class AuthzService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly webRoles: WebRoleService;
  private readonly audit: AuditService;
  private ownershipProvider: DiscordOwnershipProvider | null = null;
  private readonly ownerCache = new Map<string, { ownerId: string | null; at: number }>();
  private static readonly OWNER_CACHE_TTL_MS = 60_000;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    webRoles: WebRoleService,
    audit: AuditService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.webRoles = webRoles;
    this.audit = audit;
  }

  public setOwnershipProvider(provider: DiscordOwnershipProvider | null): void {
    this.ownershipProvider = provider;
    this.ownerCache.clear();
  }

  public isGlobalOwner(userId: string): boolean {
    return isPermanentGlobalOwner(userId);
  }

  public getGlobalScopesForUser(userId: string): GlobalScope[] {
    if (this.isGlobalOwner(userId)) return [...GLOBAL_SCOPES];
    const scopes = new Set<GlobalScope>();
    for (const assignment of this.webRoles.getEffectiveAssignments(userId, null)) {
      for (const scope of assignment.permissions) {
        if (isGlobalScope(scope)) scopes.add(scope);
      }
    }
    // Legacy Global Administrator scopes appointed through /owner admins add.
    const legacy = this.db.all<{ scope: string }>(
      `SELECT s.scope FROM bot_admin_scopes s
       JOIN bot_admins a ON a.user_id = s.user_id
       WHERE s.user_id = ? AND a.active = 1`,
      [userId],
    );
    const legacyMap: Record<string, GlobalScope> = {
      VIEW_GLOBAL_STATS: 'GLOBAL_ANALYTICS',
      VIEW_GUILDS: 'GLOBAL_VIEW_ALL',
      INSPECT_DIAGNOSTICS: 'GLOBAL_SYSTEM',
      VIEW_AUDIT_LOGS: 'GLOBAL_VIEW_AUDIT',
      REVIEW_CASES: 'GLOBAL_SYSTEM',
    };
    for (const row of legacy) {
      const mapped = legacyMap[row.scope];
      if (mapped) scopes.add(mapped);
    }
    return [...scopes];
  }

  public hasGlobalScope(userId: string, scope: GlobalScope): boolean {
    if (this.isGlobalOwner(userId)) return true;
    return this.getGlobalScopesForUser(userId).includes(scope);
  }

  public assertGlobalScope(userId: string, scope: GlobalScope, action: string): void {
    if (!this.hasGlobalScope(userId, scope)) {
      this.audit.log({
        guildId: null,
        actorUserId: userId,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'GLOBAL_SCOPE_DENIED',
        metadata: { scope, action },
      });
      throw new Error('Access Denied: this platform operation requires an explicitly granted global permission.');
    }
  }

  public async resolveGuildAccess(userId: string, guildId: string): Promise<GuildAccess> {
    const guild = this.guildConfig.getGuildConfig(guildId);
    if (!guild) {
      throw new Error('Access Denied: that Discord server is not registered with TANVEER STAFF MONITOR.');
    }

    const globalOwner = this.isGlobalOwner(userId);
    const globalScopes = new Set<GlobalScope>(this.getGlobalScopesForUser(userId));

    let effectiveOwnerId = guild.owner_id;
    let ownershipVerified = false;
    if (this.ownershipProvider) {
      const actual = await this.fetchOwnerId(guildId);
      if (actual) {
        ownershipVerified = true;
        if (actual !== effectiveOwnerId) {
          // Discord is the source of truth: ownership transfers are reflected immediately.
          effectiveOwnerId = this.guildConfig.ensureGuildRegistered(guildId, guild.guild_name, actual).owner_id;
        }
      }
    }

    const isServerOwner = effectiveOwnerId === userId;
    const isActiveStaff = Boolean(
      this.db.get<{ id: number }>(
        'SELECT id FROM staff_profiles WHERE guild_id = ? AND user_id = ? AND is_currently_staff = 1',
        [guildId, userId],
      ),
    );

    const localScopes = new Set<LocalScope>();
    const roles: WebRole[] = [];

    if (globalOwner || isServerOwner) {
      for (const scope of OWNER_LOCAL_SCOPES) localScopes.add(scope);
    }

    const assignments = this.webRoles.getEffectiveAssignments(userId, guildId);
    for (const assignment of assignments) {
      if (assignment.role === 'GLOBAL_ADMIN') continue;
      roles.push(assignment.role);
      for (const scope of assignment.permissions) {
        if (!isGlobalScope(scope)) localScopes.add(scope as LocalScope);
      }
    }

    // Legacy guild permission assignments remain honored (preserves existing deployments).
    const legacy = this.db.all<LegacyPermissionRow>(
      `SELECT permission_level, target_type, target_id, can_approve_warnings, can_manage_leave,
              can_view_reports, can_configure_bot
       FROM guild_permission_assignments
       WHERE guild_id = ? AND target_type = 'USER' AND target_id = ?`,
      [guildId, userId],
    );
    for (const row of legacy) {
      const grant = (scope: LocalScope) => localScopes.add(scope);
      if (row.can_view_reports === 1) {
        grant('SERVER_VIEW_OVERVIEW');
        grant('SERVER_VIEW_STAFF');
        grant('SERVER_VIEW_TICKETS');
        grant('SERVER_VIEW_ANALYTICS');
        grant('SERVER_EXPORT_REPORTS');
      }
      if (row.can_approve_warnings === 1) {
        grant('SERVER_VIEW_OVERVIEW');
        grant('SERVER_VIEW_STAFF');
        grant('SERVER_MANAGE_REVIEWS');
        grant('SERVER_MANAGE_WARNINGS');
      }
      if (row.can_manage_leave === 1) {
        grant('SERVER_VIEW_OVERVIEW');
        grant('SERVER_VIEW_STAFF');
        grant('SERVER_MANAGE_LEAVE');
      }
      if (row.can_configure_bot === 1) {
        grant('SERVER_MANAGE_SETTINGS');
        grant('SERVER_MANAGE_STAFF');
        grant('SERVER_MANAGE_TICKETS');
        grant('SERVER_MANAGE_INTEGRATIONS');
      }
    }

    if (isActiveStaff && localScopes.size === 0) {
      // Active staff may always view their own profile, never another member's data.
      localScopes.add('STAFF_SELF_VIEW');
    }

    let actorKind: ActorRoleKind = 'NONE';
    if (globalOwner) actorKind = 'GLOBAL_OWNER';
    else if (isServerOwner) actorKind = 'SERVER_OWNER';
    else if (roles.includes('SERVER_CO_OWNER')) actorKind = 'SERVER_CO_OWNER';
    else if (roles.includes('SERVER_ADMIN')) actorKind = 'SERVER_ADMIN';
    else if (roles.includes('SERVER_VIEWER')) actorKind = 'SERVER_VIEWER';
    else if (roles.includes('STAFF_VIEWER')) actorKind = 'STAFF_VIEWER';

    return {
      userId,
      guildId,
      guildName: guild.guild_name,
      isGlobalOwner: globalOwner,
      isServerOwner,
      ownershipVerified,
      globalScopes,
      localScopes,
      roles,
      actorKind,
      assignments,
      isActiveStaff,
    };
  }

  public hasLocalScope(access: GuildAccess, scope: LocalScope): boolean {
    return access.localScopes.has(scope);
  }

  public assertLocalScope(access: GuildAccess, scope: LocalScope, action: string): void {
    if (!access.localScopes.has(scope)) {
      this.audit.log({
        guildId: access.guildId,
        actorUserId: access.userId,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'LOCAL_SCOPE_DENIED',
        metadata: { scope, action },
      });
      throw new Error(`Access Denied: you do not have the ${scope} permission in this server.`);
    }
  }

  public toRoleActor(access: GuildAccess, username: string): RoleActor {
    return {
      userId: access.userId,
      username,
      kind: access.actorKind,
      guildId: access.guildId,
      scopes: [...access.localScopes, ...access.globalScopes],
    };
  }

  /** Lists every guild the user may legitimately open in the dashboard. */
  public async listAccessibleGuilds(
    userId: string,
    oauthGuildIds: readonly string[] = [],
    oauthOwnedGuildIds: readonly string[] = [],
  ): Promise<UserAccessSummary['guilds']> {
    const allGuilds = this.guildConfig.listAllGuilds();
    const oauthSet = new Set(oauthGuildIds);
    const ownedSet = new Set(oauthOwnedGuildIds);
    const result: UserAccessSummary['guilds'] = [];

    for (const guild of allGuilds) {
      const access = await this.resolveGuildAccess(userId, guild.guild_id);
      const canOpen =
        access.isGlobalOwner ||
        access.isServerOwner ||
        access.assignments.length > 0 ||
        access.localScopes.size > 0 ||
        (oauthSet.has(guild.guild_id) && ownedSet.has(guild.guild_id));

      if (!canOpen) continue;

      result.push({
        guild_id: guild.guild_id,
        guild_name: guild.guild_name,
        role: access.actorKind,
        is_owner: access.isServerOwner,
        is_staff: access.isActiveStaff,
        scopes: [...access.localScopes],
      });
    }

    return result.sort((a, b) => a.guild_name.localeCompare(b.guild_name));
  }

  public async buildUserAccessSummary(
    userId: string,
    oauthGuildIds: readonly string[] = [],
    oauthOwnedGuildIds: readonly string[] = [],
  ): Promise<UserAccessSummary> {
    return {
      userId,
      isGlobalOwner: this.isGlobalOwner(userId),
      globalScopes: this.getGlobalScopesForUser(userId),
      assignments: this.webRoles.getEffectiveAssignments(userId),
      guilds: await this.listAccessibleGuilds(userId, oauthGuildIds, oauthOwnedGuildIds),
    };
  }

  public scopeDefaultsForRole(role: WebRole): WebScope[] {
    return [...ROLE_DEFAULT_SCOPES[role]];
  }

  private async fetchOwnerId(guildId: string): Promise<string | null> {
    const cached = this.ownerCache.get(guildId);
    if (cached && Date.now() - cached.at < AuthzService.OWNER_CACHE_TTL_MS) {
      return cached.ownerId;
    }
    try {
      const ownerId = await this.ownershipProvider!.getGuildOwnerId(guildId);
      this.ownerCache.set(guildId, { ownerId, at: Date.now() });
      return ownerId;
    } catch {
      this.ownerCache.set(guildId, { ownerId: null, at: Date.now() });
      return null;
    }
  }
}
