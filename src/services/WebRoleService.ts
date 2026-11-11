import { IRelationalDatabase } from '../database/connection';
import {
  GRANTABLE_ROLES,
  ROLE_ALLOWED_SCOPES,
  ROLE_DEFAULT_SCOPES,
  WebRole,
  WebScope,
  isWebRole,
  sanitizeScopes,
} from '../types/access';
import { generateEntityId, isValidSnowflake } from '../utils/ids';
import { AuditService } from './AuditService';
import { GuildConfigService } from './GuildConfigService';

export type WebAssignmentStatus = 'ACTIVE' | 'SUSPENDED' | 'REVOKED' | 'EXPIRED';

export interface WebRoleAssignmentRecord {
  assignment_id: string;
  user_id: string;
  username: string;
  guild_id: string | null;
  role: WebRole;
  permissions_json: string;
  status: WebAssignmentStatus;
  assigned_by: string;
  assigned_by_name: string | null;
  assigned_at: string;
  expires_at: string | null;
  last_access_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  reason: string | null;
  updated_at: string;
}

export interface WebRoleAssignmentView extends Omit<WebRoleAssignmentRecord, 'permissions_json'> {
  permissions: WebScope[];
  guild_name?: string | null;
}

export type ActorRoleKind = 'GLOBAL_OWNER' | 'SERVER_OWNER' | WebRole | 'NONE';

export interface RoleActor {
  userId: string;
  username: string;
  kind: ActorRoleKind;
  guildId?: string | null;
  scopes: readonly WebScope[];
}

export interface AssignWebRoleInput {
  targetUserId: string;
  targetUsername: string;
  guildId?: string | null;
  role: WebRole;
  permissions?: readonly string[];
  expiresAt?: string | null;
  reason?: string | null;
}

const MAX_EXPIRY_DAYS = 3650;

export class WebRoleService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, guildConfig: GuildConfigService, audit: AuditService) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.audit = audit;
  }

  public defaultPermissionsForRole(role: WebRole): WebScope[] {
    return [...ROLE_DEFAULT_SCOPES[role]];
  }

  public allowedPermissionsForRole(role: WebRole): WebScope[] {
    return [...ROLE_ALLOWED_SCOPES[role]];
  }

  public listAssignments(filter?: {
    guildId?: string | null;
    userId?: string;
    includeInactive?: boolean;
  }): WebRoleAssignmentView[] {
    this.expireElapsedAssignments();
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter?.guildId !== undefined) {
      if (filter.guildId === null) {
        clauses.push('guild_id IS NULL');
      } else {
        clauses.push('guild_id = ?');
        params.push(filter.guildId);
      }
    }
    if (filter?.userId) {
      clauses.push('user_id = ?');
      params.push(filter.userId);
    }
    if (!filter?.includeInactive) {
      clauses.push("status IN ('ACTIVE','SUSPENDED')");
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db.all<WebRoleAssignmentRecord>(
      `SELECT * FROM web_role_assignments ${where} ORDER BY assigned_at DESC`,
      params,
    );
    return rows.map((r) => this.toView(r));
  }

  public getAssignment(assignmentId: string): WebRoleAssignmentView | null {
    const row = this.db.get<WebRoleAssignmentRecord>(
      'SELECT * FROM web_role_assignments WHERE assignment_id = ?',
      [assignmentId],
    );
    return row ? this.toView(row) : null;
  }

  /** Assigns or refreshes a website role, enforcing privilege boundaries. */
  public assignRole(actor: RoleActor, input: AssignWebRoleInput): WebRoleAssignmentView {
    this.assertCanAssign(actor, input);

    const now = new Date().toISOString();
    const permissions = this.resolvePermissionsForAssignment(input.role, input.permissions);
    const expiresAt = this.normalizeExpiry(input.expiresAt);
    const guildId = input.role === 'GLOBAL_ADMIN' ? null : (input.guildId ?? null);

    const existing = this.db.get<WebRoleAssignmentRecord>(
      `SELECT * FROM web_role_assignments
       WHERE user_id = ? AND IFNULL(guild_id, 'GLOBAL') = ? AND role = ?
         AND status IN ('ACTIVE','SUSPENDED')
       LIMIT 1`,
      [input.targetUserId, guildId ?? 'GLOBAL', input.role],
    );

    let assignmentId = existing?.assignment_id ?? generateEntityId('WRA');
    this.db.transaction(() => {
      if (existing) {
        this.db.run(
          `UPDATE web_role_assignments SET
             username = ?, permissions_json = ?, status = 'ACTIVE',
             assigned_by = ?, assigned_by_name = ?, assigned_at = ?,
             expires_at = ?, reason = ?, revoked_by = NULL, revoked_at = NULL,
             updated_at = ?
           WHERE assignment_id = ?`,
          [
            input.targetUsername,
            JSON.stringify(permissions),
            actor.userId,
            actor.username,
            now,
            expiresAt,
            input.reason ?? null,
            now,
            assignmentId,
          ],
        );
      } else {
        this.db.run(
          `INSERT INTO web_role_assignments (
             assignment_id, user_id, username, guild_id, role, permissions_json, status,
             assigned_by, assigned_by_name, assigned_at, expires_at, reason, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?)`,
          [
            assignmentId,
            input.targetUserId,
            input.targetUsername,
            guildId,
            input.role,
            JSON.stringify(permissions),
            actor.userId,
            actor.username,
            now,
            expiresAt,
            input.reason ?? null,
            now,
          ],
        );
      }
    });

    const saved = this.getAssignment(assignmentId)!;
    this.audit.log({
      guildId,
      actorUserId: actor.userId,
      actorTag: actor.username,
      actionCategory: 'ACCESS_ROLES',
      actionType: existing ? 'WEB_ROLE_UPDATED' : 'WEB_ROLE_ASSIGNED',
      targetType: 'USER',
      targetId: input.targetUserId,
      after: saved,
      metadata: { role: input.role, permissions, reason: input.reason ?? null },
    });
    return saved;
  }

  /** Changes an existing assignment's scopes, expiry or status with full revalidation. */
  public updateAssignment(
    actor: RoleActor,
    assignmentId: string,
    changes: { permissions?: readonly string[]; expiresAt?: string | null; reason?: string | null },
  ): WebRoleAssignmentView {
    const existing = this.getAssignment(assignmentId);
    if (!existing) throw new Error(`Role assignment \`${assignmentId}\` was not found.`);
    if (existing.status === 'REVOKED') {
      throw new Error('This assignment has already been revoked. Create a new assignment instead.');
    }

    this.assertCanManageExisting(actor, existing);
    const permissions =
      changes.permissions === undefined
        ? existing.permissions
        : this.resolvePermissionsForAssignment(existing.role, changes.permissions);

    if (changes.permissions !== undefined && actor.kind !== 'GLOBAL_OWNER' && actor.kind !== 'SERVER_OWNER') {
      const actorScopes = new Set(actor.scopes);
      const escalation = permissions.filter((p) => !actorScopes.has(p));
      if (escalation.length > 0) {
        throw new Error(`Privilege escalation blocked. You cannot grant: ${escalation.join(', ')}.`);
      }
    }

    const expiresAt =
      changes.expiresAt === undefined ? existing.expires_at : this.normalizeExpiry(changes.expiresAt);
    const now = new Date().toISOString();

    this.db.run(
      `UPDATE web_role_assignments SET permissions_json = ?, expires_at = ?, reason = COALESCE(?, reason),
         updated_at = ? WHERE assignment_id = ?`,
      [JSON.stringify(permissions), expiresAt, changes.reason ?? null, now, assignmentId],
    );

    const saved = this.getAssignment(assignmentId)!;
    this.audit.log({
      guildId: saved.guild_id,
      actorUserId: actor.userId,
      actorTag: actor.username,
      actionCategory: 'ACCESS_ROLES',
      actionType: 'WEB_ROLE_PERMISSIONS_CHANGED',
      targetType: 'USER',
      targetId: saved.user_id,
      before: existing,
      after: saved,
      metadata: { reason: changes.reason ?? null },
    });
    return saved;
  }

  public suspendAssignment(actor: RoleActor, assignmentId: string, reason: string | null): WebRoleAssignmentView {
    return this.setStatus(actor, assignmentId, 'SUSPENDED', reason);
  }

  public resumeAssignment(actor: RoleActor, assignmentId: string, reason: string | null): WebRoleAssignmentView {
    return this.setStatus(actor, assignmentId, 'ACTIVE', reason);
  }

  public revokeAssignment(actor: RoleActor, assignmentId: string, reason: string | null): WebRoleAssignmentView {
    const existing = this.getAssignment(assignmentId);
    if (!existing) throw new Error(`Role assignment \`${assignmentId}\` was not found.`);
    if (existing.status === 'REVOKED') return existing;
    this.assertCanManageExisting(actor, existing);
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE web_role_assignments SET status = 'REVOKED', revoked_by = ?, revoked_at = ?, reason = ?,
         updated_at = ? WHERE assignment_id = ?`,
      [actor.userId, now, reason, now, assignmentId],
    );
    const saved = this.getAssignment(assignmentId)!;
    this.audit.log({
      guildId: saved.guild_id,
      actorUserId: actor.userId,
      actorTag: actor.username,
      actionCategory: 'ACCESS_ROLES',
      actionType: 'WEB_ROLE_REVOKED',
      targetType: 'USER',
      targetId: saved.user_id,
      before: existing,
      after: saved,
      metadata: { reason },
    });
    return saved;
  }

  /** Returns effective, non-expired assignments for a user (global + given guild). */
  public getEffectiveAssignments(userId: string, guildId?: string | null): WebRoleAssignmentView[] {
    this.expireElapsedAssignments();
    const rows = this.db.all<WebRoleAssignmentRecord>(
      `SELECT * FROM web_role_assignments
       WHERE user_id = ? AND status = 'ACTIVE'
         AND (guild_id IS NULL OR guild_id = ?)
         AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY assigned_at ASC`,
      [userId, guildId ?? '', new Date().toISOString()],
    );
    return rows.map((r) => this.toView(r));
  }

  public markLastAccess(userId: string): void {
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE web_role_assignments SET last_access_at = ?
       WHERE user_id = ? AND status = 'ACTIVE'`,
      [now, userId],
    );
  }

  public expireElapsedAssignments(nowIso = new Date().toISOString()): number {
    return this.db.run(
      `UPDATE web_role_assignments SET status = 'EXPIRED', updated_at = ?
       WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?`,
      [nowIso, nowIso],
    ).changes;
  }

  public countActiveGlobalAdmins(): number {
    const row = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM web_role_assignments
       WHERE role = 'GLOBAL_ADMIN' AND status = 'ACTIVE'`,
    );
    return row?.cnt ?? 0;
  }

  private setStatus(
    actor: RoleActor,
    assignmentId: string,
    status: 'ACTIVE' | 'SUSPENDED',
    reason: string | null,
  ): WebRoleAssignmentView {
    const existing = this.getAssignment(assignmentId);
    if (!existing) throw new Error(`Role assignment \`${assignmentId}\` was not found.`);
    this.assertCanManageExisting(actor, existing);
    const now = new Date().toISOString();
    this.db.run(
      `UPDATE web_role_assignments SET status = ?, reason = COALESCE(?, reason), updated_at = ?
       WHERE assignment_id = ?`,
      [status, reason, now, assignmentId],
    );
    const saved = this.getAssignment(assignmentId)!;
    this.audit.log({
      guildId: saved.guild_id,
      actorUserId: actor.userId,
      actorTag: actor.username,
      actionCategory: 'ACCESS_ROLES',
      actionType: status === 'ACTIVE' ? 'WEB_ROLE_RESUMED' : 'WEB_ROLE_SUSPENDED',
      targetType: 'USER',
      targetId: saved.user_id,
      after: saved,
      metadata: { reason },
    });
    return saved;
  }

  private assertCanAssign(actor: RoleActor, input: AssignWebRoleInput): void {
    if (!isWebRole(input.role)) {
      throw new Error(`Unknown website role "${String(input.role)}".`);
    }
    if (!isValidSnowflake(input.targetUserId)) {
      throw new Error(`Invalid Discord User ID: "${input.targetUserId}".`);
    }
    if (actor.userId === input.targetUserId) {
      this.deny(actor, 'SELF_PROMOTION_BLOCKED', input.guildId ?? null, input.targetUserId);
      throw new Error('Self-promotion is blocked: you cannot assign or change your own website role.');
    }

    if (input.role === 'GLOBAL_ADMIN') {
      if (actor.kind !== 'GLOBAL_OWNER') {
        this.deny(actor, 'GLOBAL_ADMIN_ASSIGNMENT_DENIED', null, input.targetUserId);
        throw new Error('Only the Permanent Global Owner can appoint Global Administrators.');
      }
      if (input.guildId) {
        throw new Error('Global Administrator assignments are platform-wide and cannot be guild-scoped.');
      }
      return;
    }

    if (actor.kind === 'GLOBAL_OWNER') {
      if (!input.guildId) throw new Error('Server roles require an explicit server selection.');
      this.guildConfig.getGuildConfigOrThrow(input.guildId);
      return;
    }

    if (!input.guildId) throw new Error('Server roles require an explicit server selection.');
    this.guildConfig.getGuildConfigOrThrow(input.guildId);

    if (actor.kind === 'SERVER_OWNER') {
      if (actor.guildId && actor.guildId !== input.guildId) {
        throw new Error('Cross-server role assignment blocked.');
      }
      return;
    }

    const grantable = GRANTABLE_ROLES[actor.kind as WebRole] ?? [];
    if (!grantable.includes(input.role)) {
      this.deny(actor, 'ROLE_GRANT_DENIED', input.guildId, input.targetUserId);
      throw new Error(`Your role (${actor.kind}) cannot grant ${input.role}.`);
    }
  }

  private assertCanManageExisting(actor: RoleActor, existing: WebRoleAssignmentView): void {
    if (actor.kind === 'GLOBAL_OWNER') return;
    if (existing.role === 'GLOBAL_ADMIN') {
      throw new Error('Only the Permanent Global Owner can manage Global Administrator assignments.');
    }
    if (actor.kind === 'SERVER_OWNER') {
      if (actor.guildId && existing.guild_id !== actor.guildId) {
        throw new Error('Cross-server role management blocked.');
      }
      return;
    }
    const grantable = GRANTABLE_ROLES[actor.kind as WebRole] ?? [];
    if (!grantable.includes(existing.role) || existing.guild_id !== actor.guildId) {
      this.deny(actor, 'ROLE_MANAGE_DENIED', existing.guild_id, existing.user_id);
      throw new Error('You do not have authority to manage this role assignment.');
    }
  }

  private resolvePermissionsForAssignment(role: WebRole, requested?: readonly string[]): WebScope[] {
    const allowed = new Set(ROLE_ALLOWED_SCOPES[role]);
    if (!requested || requested.length === 0) {
      return [...ROLE_DEFAULT_SCOPES[role]];
    }
    const cleaned = sanitizeScopes(requested);
    const invalid = cleaned.filter((p) => !allowed.has(p));
    if (invalid.length > 0) {
      throw new Error(`Permissions not permitted for ${role}: ${invalid.join(', ')}.`);
    }
    if (cleaned.length === 0) {
      throw new Error('At least one valid permission scope is required.');
    }
    return cleaned;
  }

  private normalizeExpiry(expiresAt?: string | null): string | null {
    if (!expiresAt) return null;
    const ms = Date.parse(expiresAt);
    if (!Number.isFinite(ms)) throw new Error('Invalid role expiration date.');
    const now = Date.now();
    if (ms <= now) throw new Error('Role expiration must be in the future.');
    if (ms > now + MAX_EXPIRY_DAYS * 86_400_000) {
      throw new Error('Role expiration cannot exceed 10 years.');
    }
    return new Date(ms).toISOString();
  }

  private deny(actor: RoleActor, actionType: string, guildId: string | null, targetId: string): void {
    this.audit.log({
      guildId,
      actorUserId: actor.userId,
      actorTag: actor.username,
      actionCategory: 'UNAUTHORIZED_ATTEMPT',
      actionType,
      targetType: 'USER',
      targetId,
      metadata: { actorKind: actor.kind },
    });
  }

  private toView(row: WebRoleAssignmentRecord): WebRoleAssignmentView {
    let permissions: WebScope[] = [];
    try {
      permissions = sanitizeScopes(JSON.parse(row.permissions_json) as string[]);
    } catch {
      permissions = [];
    }
    const guild = row.guild_id ? this.guildConfig.getGuildConfig(row.guild_id) : undefined;
    return {
      assignment_id: row.assignment_id,
      user_id: row.user_id,
      username: row.username,
      guild_id: row.guild_id,
      guild_name: guild?.guild_name ?? (row.guild_id ? null : 'All Servers (Global)'),
      role: row.role,
      permissions,
      status: row.status,
      assigned_by: row.assigned_by,
      assigned_by_name: row.assigned_by_name,
      assigned_at: row.assigned_at,
      expires_at: row.expires_at,
      last_access_at: row.last_access_at,
      revoked_by: row.revoked_by,
      revoked_at: row.revoked_at,
      reason: row.reason,
      updated_at: row.updated_at,
    };
  }
}
