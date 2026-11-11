import crypto from 'node:crypto';
import { IRelationalDatabase } from '../database/connection';
import { generateEntityId } from '../utils/ids';
import { AuditService } from '../services/AuditService';

export interface WebSessionRecord {
  session_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
  ip_hash: string | null;
  user_agent: string | null;
}

export interface ResolvedWebSession extends WebSessionRecord {
  csrfToken: string;
}

export interface WebUserProfile {
  id: string;
  username: string;
  globalName?: string | null;
  avatarUrl: string | null;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export class WebSessionService {
  private readonly db: IRelationalDatabase;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, audit: AuditService) {
    this.db = db;
    this.audit = audit;
  }

  public createSession(
    user: WebUserProfile,
    options: { ttlHours: number; ip?: string | null; userAgent?: string | null },
  ): { token: string; csrfToken: string; session: WebSessionRecord } {
    const token = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(24).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + Math.max(1, options.ttlHours) * 3_600_000);

    this.db.run(
      `INSERT INTO website_sessions (
        session_id, token_hash, user_id, username, avatar_url, csrf_token,
        created_at, last_seen_at, expires_at, ip_hash, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateEntityId('SES'),
        sha256(token),
        user.id,
        user.username,
        user.avatarUrl,
        csrfToken,
        now.toISOString(),
        now.toISOString(),
        expires.toISOString(),
        options.ip ? sha256(options.ip) : null,
        options.userAgent ? options.userAgent.slice(0, 300) : null,
      ],
    );

    const session = this.db.get<WebSessionRecord>(
      `SELECT session_id, user_id, username, avatar_url, created_at, last_seen_at, expires_at,
              revoked_at, ip_hash, user_agent
       FROM website_sessions WHERE token_hash = ?`,
      [sha256(token)],
    )!;

    this.audit.log({
      guildId: null,
      actorUserId: user.id,
      actorTag: user.username,
      actionCategory: 'WEB_SESSION',
      actionType: 'LOGIN_SUCCESS',
      targetType: 'SESSION',
      targetId: session.session_id,
      metadata: { ipHash: session.ip_hash },
    });

    return { token, csrfToken, session };
  }

  public resolveSession(token: string | null | undefined): ResolvedWebSession | null {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const row = this.db.get<WebSessionRecord & { csrf_token: string }>(
      `SELECT session_id, user_id, username, avatar_url, csrf_token, created_at, last_seen_at,
              expires_at, revoked_at, ip_hash, user_agent
       FROM website_sessions WHERE token_hash = ?`,
      [sha256(token)],
    );
    if (!row) return null;
    if (row.revoked_at) return null;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.revokeSession(row.session_id, 'EXPIRED');
      return null;
    }

    // Throttle last_seen writes to once per five minutes per session.
    if (Date.now() - Date.parse(row.last_seen_at) > 300_000) {
      this.db.run('UPDATE website_sessions SET last_seen_at = ? WHERE session_id = ?', [
        new Date().toISOString(),
        row.session_id,
      ]);
    }

    return { ...row, csrfToken: row.csrf_token };
  }

  public revokeSession(sessionId: string, reason: string): boolean {
    const now = new Date().toISOString();
    const changes = this.db.run(
      'UPDATE website_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE session_id = ?',
      [now, sessionId],
    ).changes;
    if (changes > 0) {
      const session = this.db.get<WebSessionRecord>(
        'SELECT * FROM website_sessions WHERE session_id = ?',
        [sessionId],
      );
      this.audit.log({
        guildId: null,
        actorUserId: session?.user_id ?? 'SYSTEM',
        actionCategory: 'WEB_SESSION',
        actionType: 'SESSION_REVOKED',
        targetType: 'SESSION',
        targetId: sessionId,
        metadata: { reason },
      });
    }
    return changes > 0;
  }

  public revokeByToken(token: string, reason: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(token)) return false;
    const row = this.db.get<{ session_id: string }>(
      'SELECT session_id FROM website_sessions WHERE token_hash = ?',
      [sha256(token)],
    );
    return row ? this.revokeSession(row.session_id, reason) : false;
  }

  public listUserSessions(userId: string, includeRevoked = false): WebSessionRecord[] {
    return this.db.all<WebSessionRecord>(
      `SELECT session_id, user_id, username, avatar_url, created_at, last_seen_at, expires_at,
              revoked_at, ip_hash, user_agent
       FROM website_sessions WHERE user_id = ? ${includeRevoked ? '' : 'AND revoked_at IS NULL'}
       ORDER BY last_seen_at DESC LIMIT 50`,
      [userId],
    );
  }

  public listAllSessions(includeRevoked = false): WebSessionRecord[] {
    return this.db.all<WebSessionRecord>(
      `SELECT session_id, user_id, username, avatar_url, created_at, last_seen_at, expires_at,
              revoked_at, ip_hash, user_agent
       FROM website_sessions ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'}
       ORDER BY last_seen_at DESC LIMIT 200`,
    );
  }

  public cleanupExpired(nowIso = new Date().toISOString()): number {
    return this.db.run(
      `UPDATE website_sessions SET revoked_at = COALESCE(revoked_at, ?)
       WHERE expires_at <= ? AND revoked_at IS NULL`,
      [nowIso, nowIso],
    ).changes;
  }
}
