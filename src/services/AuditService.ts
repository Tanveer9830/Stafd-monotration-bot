import { IRelationalDatabase } from '../database/connection';
import { generateEntityId } from '../utils/ids';
import { isPermanentGlobalOwner } from '../config/branding';

export interface AuditLogRecord {
  audit_id: string;
  guild_id: string | null;
  actor_user_id: string;
  actor_tag: string | null;
  action_category: string;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  before_json: string | null;
  after_json: string | null;
  metadata_json: string | null;
  created_at: string;
}

export interface CreateAuditLogInput {
  guildId?: string | null;
  actorUserId: string;
  actorTag?: string | null;
  actionCategory:
    | 'OWNER_SECURITY'
    | 'PERMISSIONS'
    | 'ROSTER'
    | 'TICKET'
    | 'SCANNER'
    | 'REVIEW'
    | 'WARNING'
    | 'LEAVE'
    | 'SETTINGS'
    | 'BACKUP'
    | 'UNAUTHORIZED_ATTEMPT';
  actionType: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

export class AuditService {
  private readonly db: IRelationalDatabase;

  constructor(db: IRelationalDatabase) {
    this.db = db;
  }

  public log(input: CreateAuditLogInput): AuditLogRecord {
    const auditId = generateEntityId('AUD');
    const now = new Date().toISOString();
    const beforeJson = input.before !== undefined ? JSON.stringify(input.before) : null;
    const afterJson = input.after !== undefined ? JSON.stringify(input.after) : null;
    const metadataJson = input.metadata !== undefined ? JSON.stringify(input.metadata) : null;

    this.db.run(
      `INSERT INTO audit_logs (
        audit_id, guild_id, actor_user_id, actor_tag, action_category, action_type,
        target_type, target_id, before_json, after_json, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        input.guildId ?? null,
        input.actorUserId,
        input.actorTag ?? null,
        input.actionCategory,
        input.actionType,
        input.targetType ?? null,
        input.targetId ?? null,
        beforeJson,
        afterJson,
        metadataJson,
        now,
      ],
    );

    return {
      audit_id: auditId,
      guild_id: input.guildId ?? null,
      actor_user_id: input.actorUserId,
      actor_tag: input.actorTag ?? null,
      action_category: input.actionCategory,
      action_type: input.actionType,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      before_json: beforeJson,
      after_json: afterJson,
      metadata_json: metadataJson,
      created_at: now,
    };
  }

  /**
   * Guild-isolated audit query. Requires an explicit guildId and never returns
   * records belonging to another guild or global-only records.
   */
  public listGuildLogs(
    guildId: string,
    options?: { category?: string; limit?: number; offset?: number },
  ): AuditLogRecord[] {
    if (!guildId) {
      throw new Error('Guild ID is required for guild-scoped audit log queries.');
    }
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);

    if (options?.category) {
      return this.db.all<AuditLogRecord>(
        `SELECT * FROM audit_logs
         WHERE guild_id = ? AND action_category = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [guildId, options.category, limit, offset],
      );
    }

    return this.db.all<AuditLogRecord>(
      `SELECT * FROM audit_logs
       WHERE guild_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [guildId, limit, offset],
    );
  }

  /**
   * Global audit log query strictly restricted to the Permanent Global Owner
   * (or explicitly scoped Bot Administrators with VIEW_AUDIT_LOGS).
   */
  public listGlobalLogs(
    requesterUserId: string,
    hasBotAdminAuditScope = false,
    options?: { guildId?: string; category?: string; limit?: number; offset?: number },
  ): AuditLogRecord[] {
    if (!isPermanentGlobalOwner(requesterUserId) && !hasBotAdminAuditScope) {
      throw new Error('Unauthorized: Global audit logs are restricted to the Global Owner.');
    }

    const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options?.guildId) {
      clauses.push('guild_id = ?');
      params.push(options.guildId);
    }
    if (options?.category) {
      clauses.push('action_category = ?');
      params.push(options.category);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);

    return this.db.all<AuditLogRecord>(
      `SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      params,
    );
  }
}
