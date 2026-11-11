import { PlatformContainer } from '../container';
import { GuildAccess } from '../services/AuthzService';
import {
  GRANTABLE_ROLES,
  PERMISSION_MATRIX,
  ROLE_ALLOWED_SCOPES,
  ROLE_DEFAULT_SCOPES,
  WEB_ROLE_LABELS,
  WebRole,
  WebScope,
  isWebRole,
} from '../types/access';
import { ReportPeriodType } from '../services/AnalyticsService';
import { StaffMonitoringStatus } from '../config/theme';
import { StaffRoleCategory } from '../types/domain';
import { RequestContext, asNumber, asString, asStringArray, pagination, sendJson } from './http';
import { WebDiscordProvider } from './DiscordWebProvider';
import { WebSessionService } from './WebSessionService';

export interface ApiDeps {
  container: PlatformContainer;
  provider: WebDiscordProvider;
  sessionService: WebSessionService;
}

class HttpError extends Error {
  public readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function requireSession(ctx: RequestContext): NonNullable<RequestContext['session']> {
  if (!ctx.session) throw new HttpError(401, 'Authentication required. Sign in with Discord.');
  return ctx.session;
}

function requireCsrfToken(ctx: RequestContext): void {
  const session = requireSession(ctx);
  const provided = ctx.req.headers['x-csrf-token'];
  const token = Array.isArray(provided) ? provided[0] : provided;
  if (!token || token !== session.csrfToken) {
    throw new HttpError(403, 'CSRF validation failed. Refresh the dashboard and try again.');
  }
}

async function requireGuild(
  ctx: RequestContext,
  deps: ApiDeps,
  guildId: string,
  scope?: string,
): Promise<GuildAccess> {
  const session = requireSession(ctx);
  let access: GuildAccess;
  try {
    access = await deps.container.authz.resolveGuildAccess(session.user_id, guildId);
  } catch {
    throw new HttpError(403, 'You do not have access to that server.');
  }
  if (access.localScopes.size === 0) {
    throw new HttpError(403, 'You do not have access to that server.');
  }
  if (scope) deps.container.authz.assertLocalScope(access, scope as never, `WEB:${ctx.url.pathname}`);
  deps.container.webRoles.markLastAccess(session.user_id);
  return access;
}

function requireGlobal(ctx: RequestContext, deps: ApiDeps, scope?: string | null): NonNullable<RequestContext['session']> {
  const session = requireSession(ctx);
  if (scope) {
    deps.container.authz.assertGlobalScope(session.user_id, scope as never, `WEB:${ctx.url.pathname}`);
  } else if (!deps.container.authz.isGlobalOwner(session.user_id)) {
    deps.container.audit.log({
      guildId: null,
      actorUserId: session.user_id,
      actionCategory: 'UNAUTHORIZED_ATTEMPT',
      actionType: 'WEB_GLOBAL_OWNER_DENIED',
      metadata: { path: ctx.url.pathname },
    });
    throw new HttpError(403, 'Access Denied: this area is reserved for the Permanent Global Owner.');
  }
  return session;
}

function bodyObject(ctx: RequestContext): Record<string, unknown> {
  const body = ctx.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

function parsePeriod(value: unknown): { periodType: ReportPeriodType; from?: string; to?: string } {
  const raw = asString(value, 20).toUpperCase();
  const allowed: ReportPeriodType[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM'];
  const periodType = (allowed.includes(raw as ReportPeriodType) ? raw : 'WEEKLY') as ReportPeriodType;
  return { periodType };
}

function toActor(access: GuildAccess, username: string) {
  return {
    userId: access.userId,
    userTag: username,
    guildId: access.guildId,
    actualGuildOwnerId: access.isServerOwner ? access.userId : undefined,
    memberRoleIds: [] as string[],
  };
}

function staffName(container: PlatformContainer, guildId: string, userId: string | null): string | null {
  if (!userId) return null;
  const profile = container.roster.getStaffProfile(guildId, userId);
  return profile?.display_name ?? profile?.username ?? null;
}

function ticketDto(container: PlatformContainer, guildId: string, t: Record<string, unknown>) {
  return {
    ticket_id: t.ticket_id,
    ticket_number: t.ticket_number,
    channel_id: t.channel_id,
    channel_name: t.channel_name,
    parent_category_id: t.parent_category_id,
    status: t.status,
    claim_type: t.claim_type ?? 'NONE',
    claim_at: t.claim_at,
    opener_user_id: t.opener_user_id,
    claimed_by_user_id: t.claimed_by_user_id,
    assigned_to_user_id: t.assigned_to_user_id,
    assigned_name: staffName(container, guildId, (t.assigned_to_user_id as string) ?? null),
    first_response_staff_id: t.first_response_staff_id,
    first_responder_name: staffName(container, guildId, (t.first_response_staff_id as string) ?? null),
    opened_at: t.opened_at,
    last_activity_at: t.last_activity_at,
    first_staff_response_at: t.first_staff_response_at,
    first_response_sec: t.first_response_sec,
    resolved_at: t.resolved_at,
    resolution_sec: t.resolution_sec,
    reopened_count: t.reopened_count,
    staff_message_count: t.staff_message_count,
    meaningful_response_count: t.meaningful_response_count,
    last_responder_user_id: t.last_responder_user_id,
    adapter_source: t.adapter_source,
  };
}

function staffDto(container: PlatformContainer, guildId: string, p: Record<string, unknown>) {
  let roleIds: string[] = [];
  try {
    roleIds = JSON.parse(String(p.active_role_ids_json ?? '[]')) as string[];
  } catch {
    roleIds = [];
  }
  const configured = new Map(container.roster.listStaffRoles(guildId).map((r) => [r.role_id, r.role_name]));
  return {
    user_id: p.user_id,
    username: p.username,
    display_name: p.display_name,
    monitoring_status: p.monitoring_status,
    monitoring_coverage: p.monitoring_coverage,
    primary_category: p.primary_category,
    is_currently_staff: p.is_currently_staff,
    role_ids: roleIds,
    role_names: roleIds.map((id) => configured.get(id) ?? id),
    joined_staff_at: p.joined_staff_at,
    last_qualifying_work_at: p.last_qualifying_work_at,
    last_ticket_activity_at: p.last_ticket_activity_at,
    current_workload: p.current_workload,
    tickets_handled_count: p.tickets_handled_count,
    tickets_resolved_count: p.tickets_resolved_count,
    avg_first_response_sec: p.avg_first_response_sec,
    avg_resolution_sec: p.avg_resolution_sec,
    active_warnings_count: p.active_warnings_count,
    total_warnings_count: p.total_warnings_count,
    presence_status: p.presence_status,
  };
}

export class WebApi {
  public async handle(ctx: RequestContext, deps: ApiDeps): Promise<void> {
    const { container } = deps;
    const parts = ctx.url.pathname.split('/').filter(Boolean);
    const method = (ctx.req.method ?? 'GET').toUpperCase();

    if (parts[1] === 'public' && parts[2] === 'config') {
      sendJson(ctx.res, 200, {
        ok: true,
        data: {
          projectName: 'TANVEER STAFF MONITOR',
          creator: '⚡ Made by Tanveer | Discord: tanveer5637',
          oauthConfigured: Boolean(container.config.discordClientId && container.config.discordClientSecret),
          globalOwnerConfigured: Boolean(container.config.globalOwnerId),
        },
      });
      return;
    }

    if (parts[1] === 'me') {
      const session = requireSession(ctx);
      const summary = await container.authz.buildUserAccessSummary(session.user_id);
      const isStaffAnywhere = summary.guilds.some((g) => g.is_staff);
      sendJson(ctx.res, 200, {
        ok: true,
        data: {
          user: {
            id: session.user_id,
            username: session.username,
            avatarUrl: session.avatar_url,
          },
          csrfToken: session.csrfToken,
          isGlobalOwner: summary.isGlobalOwner,
          globalScopes: summary.globalScopes,
          assignments: summary.assignments.map((a) => ({
            assignment_id: a.assignment_id,
            guild_id: a.guild_id,
            guild_name: a.guild_name,
            role: a.role,
            roleLabel: WEB_ROLE_LABELS[a.role],
            permissions: a.permissions,
            expires_at: a.expires_at,
            status: a.status,
          })),
          guilds: summary.guilds,
          isStaffAnywhere,
          branding: { footer: '⚡ Made by Tanveer | Discord: tanveer5637' },
        },
      });
      return;
    }

    if (isMutatingMethod(method)) requireCsrfToken(ctx);
    requireSession(ctx);

    // ------------------------------------------------------------------ global
    if (parts[1] === 'global') {
      const section = parts[2];

      if (section === 'overview' && method === 'GET') {
        requireGlobal(ctx, deps, container.authz.isGlobalOwner(ctx.session!.user_id) ? null : 'GLOBAL_VIEW_ALL');
        const analytics = container.analytics.buildGlobalAnalytics(ctx.session!.user_id, true);
        const guilds = container.guildConfig.listAllGuilds();
        const scanRows = container.db.all<{ guild_id: string; completed_at: string }>(
          `SELECT guild_id, MAX(completed_at) AS completed_at FROM scan_history GROUP BY guild_id`,
        );
        const scanMap = new Map(scanRows.map((s) => [s.guild_id, s.completed_at]));
        const healthRows = container.db.all<{ guild_id: string; status: string; checked_at: string }>(
          `SELECT guild_id, status, checked_at FROM monitoring_health
           WHERE id IN (SELECT MAX(id) FROM monitoring_health GROUP BY guild_id)`,
        );
        const healthMap = new Map(healthRows.map((h) => [h.guild_id, h]));
        const perGuild = analytics.guildSummaries.map((g) => {
          const cfg = guilds.find((x) => x.guild_id === g.guildId);
          const health = healthMap.get(g.guildId);
          return {
            ...g,
            ownerId: cfg?.owner_id ?? null,
            lastScanAt: scanMap.get(g.guildId) ?? null,
            health: health?.status ?? 'UNKNOWN',
            healthCheckedAt: health?.checked_at ?? null,
          };
        });
        const alerts: Array<{ level: string; title: string; detail: string }> = [];
        for (const g of perGuild) {
          if (g.health === 'ERROR') alerts.push({ level: 'error', title: `${g.guildName}: monitoring error`, detail: 'Latest monitoring health check reported ERROR.' });
          if (g.pendingReviews > 0) alerts.push({ level: 'warning', title: `${g.guildName}: ${g.pendingReviews} pending review(s)`, detail: 'Human approval is required before any warning.' });
        }
        const pendingAuto = container.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM ticket_claim_timers WHERE status = 'PENDING'",
        );
        if ((pendingAuto?.cnt ?? 0) > 0) {
          alerts.push({ level: 'info', title: `${pendingAuto!.cnt} pending automatic claim timer(s)`, detail: 'Five-minute first-responder timers awaiting expiry.' });
        }
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            generatedAt: analytics.generatedAt,
            totals: {
              guilds: analytics.totalGuilds,
              staff: analytics.totalStaff,
              ticketsMonitored: analytics.totalTicketsMonitored,
              ticketsHandled: analytics.totalTicketsHandled,
              ticketsResolved: analytics.totalTicketsResolved,
              pendingReviews: analytics.pendingReviews,
              activeWarnings: analytics.totalWarnings,
              monitoringErrors: analytics.monitoringErrors,
            },
            statusBreakdown: analytics.statusBreakdown,
            guilds: perGuild,
            alerts,
            autoClaimMinutes: container.settings.getNumber('ticket_auto_claim_minutes'),
          },
        });
        return;
      }

      if (section === 'guilds' && method === 'GET') {
        requireGlobal(ctx, deps, container.authz.isGlobalOwner(ctx.session!.user_id) ? null : 'GLOBAL_VIEW_ALL');
        const rows = container.guildConfig.listAllGuilds().map((g) => {
          const staff = container.roster.listStaffProfiles(g.guild_id, { onlyActiveStaff: true });
          const tickets = container.tickets.getGuildTicketSummary(g.guild_id);
          const roles = container.roster.listStaffRoles(g.guild_id, true);
          const reviews = container.reviews.listGuildReviews(g.guild_id, { pendingOnly: true });
          return {
            guild_id: g.guild_id,
            guild_name: g.guild_name,
            owner_id: g.owner_id,
            installed_at: g.installed_at,
            staff_count: staff.length,
            tickets_total: tickets.totalTickets,
            tickets_open: tickets.openTickets,
            pending_reviews: reviews.length,
            staff_roles: roles.length,
            thresholds: { at_risk: g.at_risk_hours, inactive: g.inactive_hours, escalation: g.escalation_hours },
          };
        });
        sendJson(ctx.res, 200, { ok: true, data: { guilds: rows } });
        return;
      }

      if (section === 'admins' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_MANAGE_ADMINS');
        const legacy = container.permissions.listBotAdmins();
        const web = container.webRoles.listAssignments({ guildId: null });
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            legacyAdmins: legacy.map((a) => ({ userId: a.user_id, username: a.username, scopes: a.scopes, createdAt: a.created_at })),
            webAdmins: web.map((a) => ({
              assignmentId: a.assignment_id,
              userId: a.user_id,
              username: a.username,
              role: a.role,
              permissions: a.permissions,
              status: a.status,
              expiresAt: a.expires_at,
              assignedBy: a.assigned_by,
              assignedAt: a.assigned_at,
            })),
            assignableScopes: ROLE_ALLOWED_SCOPES.GLOBAL_ADMIN,
          },
        });
        return;
      }

      if (section === 'admins' && method === 'POST') {
        const session = requireSession(ctx);
        if (!container.authz.isGlobalOwner(session.user_id)) {
          throw new HttpError(403, 'Only the Permanent Global Owner can assign Global Administrators.');
        }
        const body = bodyObject(ctx);
        const targetUserId = asString(body.userId, 30);
        const role = asString(body.role, 40) || 'GLOBAL_ADMIN';
        if (role !== 'GLOBAL_ADMIN') throw new HttpError(400, 'Only GLOBAL_ADMIN can be assigned at platform level.');
        if (!targetUserId) throw new HttpError(400, 'A Discord user ID is required.');
        const actor = {
          userId: session.user_id,
          username: session.username,
          kind: 'GLOBAL_OWNER' as const,
          guildId: null,
          scopes: [...container.authz.getGlobalScopesForUser(session.user_id)],
        };
        const assignment = container.webRoles.assignRole(actor as never, {
          targetUserId,
          targetUsername: asString(body.username, 80) || targetUserId,
          guildId: null,
          role: 'GLOBAL_ADMIN',
          permissions: asStringArray(body.permissions),
          expiresAt: asString(body.expiresAt, 40) || null,
          reason: asString(body.reason, 500) || null,
        });
        sendJson(ctx.res, 201, { ok: true, data: { assignment } });
        return;
      }

      if (section === 'admins' && parts[3] && method === 'DELETE') {
        const session = requireSession(ctx);
        if (!container.authz.isGlobalOwner(session.user_id)) {
          throw new HttpError(403, 'Only the Permanent Global Owner can revoke Global Administrators.');
        }
        const actor = {
          userId: session.user_id,
          username: session.username,
          kind: 'GLOBAL_OWNER' as const,
          guildId: null,
          scopes: [...container.authz.getGlobalScopesForUser(session.user_id)],
        };
        const assignment = container.webRoles.revokeAssignment(
          actor as never,
          parts[3],
          asString(bodyObject(ctx).reason, 500) || 'Revoked by the Global Owner',
        );
        sendJson(ctx.res, 200, { ok: true, data: { assignment } });
        return;
      }

      if (section === 'stats' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_ANALYTICS');
        sendJson(ctx.res, 200, {
          ok: true,
          data: container.analytics.buildGlobalAnalytics(ctx.session!.user_id, true),
        });
        return;
      }

      if (section === 'audit' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_VIEW_AUDIT');
        const limit = Math.min(100, Math.max(1, asNumber(ctx.url.searchParams.get('limit'), 50)));
        const logs = container.audit.listGlobalLogs(ctx.session!.user_id, true, {
          guildId: ctx.url.searchParams.get('guildId') ?? undefined,
          limit,
        });
        sendJson(ctx.res, 200, { ok: true, data: { logs } });
        return;
      }
    }

    // ------------------------------------------------------------------ system
    if (parts[1] === 'system') {
      const section = parts[2];

      if (section === 'health' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_SYSTEM');
        const integrations = container.db.all<{ integration_type: string; cnt: number }>(
          `SELECT integration_type, COUNT(*) AS cnt FROM integration_configs WHERE is_active = 1 GROUP BY integration_type`,
        );
        const health = container.db.all<{
          guild_id: string | null;
          component: string;
          status: string;
          coverage_level: string;
          checked_at: string;
          error_details: string | null;
        }>(
          `SELECT guild_id, component, status, coverage_level, checked_at, error_details
           FROM monitoring_health ORDER BY checked_at DESC LIMIT 100`,
        );
        const pending = container.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM ticket_claim_timers WHERE status = 'PENDING'",
        );
        const failed = container.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM ticket_claim_timers WHERE status = 'FAILED'",
        );
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            uptimeSeconds: Math.round(process.uptime()),
            node: process.version,
            memoryRssMb: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1),
            database: {
              path: container.db.dbPath,
              driver: container.db.driverNameUsed,
              integrity: container.db.integrityCheck(),
              sizeBytes: null,
            },
            migrations: container.migrator.listAppliedMigrations(),
            scheduler: container.scheduler.getSchedulerStatus(),
            health,
            integrations,
            pendingAutoClaims: pending?.cnt ?? 0,
            failedAutoClaims: failed?.cnt ?? 0,
            intents: {
              guildMembers: container.config.enableGuildMembersIntent,
              presence: container.config.enablePresenceIntent,
              messageContent: container.config.enableMessageContentIntent,
            },
            settings: container.settings.list(),
            eventListeners: container.eventBus.listenerCount,
          },
        });
        return;
      }

      if (section === 'backups' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_BACKUP');
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            backups: container.backups.listBackups().map((b) => ({
              filename: b.filename,
              sizeBytes: b.sizeBytes,
              createdAt: b.createdAt,
              integrityOk: b.integrityOk,
            })),
            databasePath: container.db.dbPath,
          },
        });
        return;
      }

      if (section === 'backups' && method === 'POST') {
        requireGlobal(ctx, deps, 'GLOBAL_BACKUP');
        const body = bodyObject(ctx);
        const label = asString(body.label, 60) || 'manual-web';
        const backup = await container.backups.createBackup(label);
        container.audit.log({
          guildId: null,
          actorUserId: ctx.session!.user_id,
          actionCategory: 'BACKUP',
          actionType: 'BACKUP_CREATED',
          targetType: 'BACKUP',
          targetId: backup.filename,
          metadata: { sizeBytes: backup.sizeBytes, source: 'web' },
        });
        sendJson(ctx.res, 201, {
          ok: true,
          data: {
            filename: backup.filename,
            sizeBytes: backup.sizeBytes,
            integrityOk: backup.integrityOk,
            createdAt: backup.createdAt,
          },
        });
        return;
      }

      if (section === 'sessions') {
        const isGlobal = container.authz.hasGlobalScope(ctx.session!.user_id, 'GLOBAL_SECURITY');
        if (parts[3] && method === 'DELETE') {
          if (!isGlobal) {
            const owner = container.db.get<{ user_id: string }>(
              'SELECT user_id FROM website_sessions WHERE session_id = ?',
              [parts[3]],
            );
            if (!owner || owner.user_id !== ctx.session!.user_id) throw new HttpError(403, 'You can only revoke your own sessions.');
          }
          deps.sessionService.revokeSession(parts[3], 'Revoked from dashboard');
          sendJson(ctx.res, 200, { ok: true, data: { revoked: true } });
          return;
        }
        if (method === 'GET') {
          const sessions = isGlobal
            ? deps.sessionService.listAllSessions(true)
            : deps.sessionService.listUserSessions(ctx.session!.user_id, true);
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              sessions: sessions.map((s) => ({
                session_id: s.session_id,
                user_id: s.user_id,
                username: s.username,
                created_at: s.created_at,
                last_seen_at: s.last_seen_at,
                expires_at: s.expires_at,
                revoked_at: s.revoked_at,
                user_agent: s.user_agent,
                current: s.session_id === ctx.session!.session_id,
              })),
              canSeeAll: isGlobal,
            },
          });
          return;
        }
      }

      if (section === 'security' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_SECURITY');
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            settings: container.settings.list(),
            globalAdmins: container.webRoles.listAssignments({ guildId: null }).map((a) => ({
              userId: a.user_id,
              username: a.username,
              role: a.role,
              permissions: a.permissions,
              status: a.status,
            })),
            recentUnauthorized: container.audit.listGlobalLogs(ctx.session!.user_id, true, { limit: 25 }).filter((l) => l.action_category === 'UNAUTHORIZED_ATTEMPT'),
            sessions: deps.sessionService.listAllSessions(false).length,
          },
        });
        return;
      }

      if (section === 'settings' && method === 'PATCH') {
        requireGlobal(ctx, deps, 'GLOBAL_SECURITY');
        const body = bodyObject(ctx);
        const key = asString(body.key, 60);
        const value = String(body.value ?? '');
        container.settings.set(key as never, value, ctx.session!.user_id, null);
        sendJson(ctx.res, 200, { ok: true, data: { settings: container.settings.list() } });
        return;
      }

      if (section === 'diagnostics' && method === 'GET') {
        requireGlobal(ctx, deps, 'GLOBAL_SYSTEM');
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            integrity: container.db.integrityCheck(),
            migrations: container.migrator.listAppliedMigrations(),
            backups: container.backups.listBackups().slice(0, 10),
            autoClaimTimers: container.db.all(
              'SELECT status, COUNT(*) AS count FROM ticket_claim_timers GROUP BY status',
            ),
            tableCounts: {
              guilds: (container.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM guild_config')?.c ?? 0),
              staff: (container.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM staff_profiles')?.c ?? 0),
              tickets: (container.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM ticket_records')?.c ?? 0),
              ticketMessages: (container.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM ticket_messages')?.c ?? 0),
            },
          },
        });
        return;
      }
    }

    // ------------------------------------------------------------------ guilds
    if (parts[1] === 'guilds' && parts[2]) {
      const guildId = parts[2];
      const section = parts[3];

      if (section === 'overview' && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_OVERVIEW');
        const cfg = container.guildConfig.getGuildConfigOrThrow(guildId);
        const staff = container.roster.listStaffProfiles(guildId, { onlyActiveStaff: true });
        const tickets = container.tickets.getGuildTicketSummary(guildId);
        const reviews = container.reviews.listGuildReviews(guildId, { pendingOnly: true });
        const warnings = container.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM warnings WHERE guild_id = ? AND status = 'ACTIVE'",
          [guildId],
        );
        const leave = container.leave.listGuildLeave(guildId, { activeOnly: true, limit: 10 });
        const scans = container.staffDiscovery.listScanHistory(guildId, 5);
        const recentTickets = container.tickets.listTickets(guildId, { pageSize: 8 });
        const pendingTimers = container.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM ticket_claim_timers WHERE guild_id = ? AND status = 'PENDING'",
          [guildId],
        );
        const health = container.db.get<{ status: string; checked_at: string; coverage_level: string }>(
          'SELECT status, checked_at, coverage_level FROM monitoring_health WHERE guild_id = ? ORDER BY checked_at DESC LIMIT 1',
          [guildId],
        );
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            guild: {
              id: cfg.guild_id,
              name: cfg.guild_name,
              ownerId: cfg.owner_id,
              ownershipVerified: access.ownershipVerified,
              installedAt: cfg.installed_at,
              thresholds: {
                atRisk: cfg.at_risk_hours,
                inactive: cfg.inactive_hours,
                escalation: cfg.escalation_hours,
                scanIntervalMinutes: cfg.scan_interval_minutes,
                observationBaselineHours: cfg.observation_baseline_hours,
              },
            },
            access: {
              role: access.actorKind,
              isServerOwner: access.isServerOwner,
              isGlobalOwner: access.isGlobalOwner,
              scopes: [...access.localScopes],
            },
            staff: {
              total: staff.length,
              breakdown: staff.reduce<Record<string, number>>((acc, s) => {
                acc[s.monitoring_status] = (acc[s.monitoring_status] ?? 0) + 1;
                return acc;
              }, {}),
            },
            tickets: {
              ...tickets,
              unclaimed: container.tickets.listTickets(guildId, { claim: 'UNCLAIMED', pageSize: 1 }).total,
              autoClaimed: container.db.get<{ cnt: number }>(
                "SELECT COUNT(*) AS cnt FROM ticket_records WHERE guild_id = ? AND claim_type = 'AUTOMATIC'",
                [guildId],
              )?.cnt ?? 0,
              pendingAutoClaims: pendingTimers?.cnt ?? 0,
            },
            pendingReviews: reviews.length,
            activeWarnings: warnings?.cnt ?? 0,
            leave: leave.map((l) => ({
              leave_id: l.leave_id,
              staff_user_id: l.staff_user_id,
              status: l.status,
              start_at: l.start_at,
              end_at: l.end_at,
            })),
            scans: scans.map((s) => ({
              scan_id: s.scan_id,
              scan_type: s.scan_type,
              completed_at: s.completed_at,
              staff_discovered: s.staff_discovered,
              newly_registered: s.newly_registered,
              coverage_level: s.coverage_level,
            })),
            recentTickets: recentTickets.items.map((t) => ticketDto(container, guildId, t as never)),
            health: health ?? null,
            autoClaimMinutes: container.settings.getNumber('ticket_auto_claim_minutes'),
          },
        });
        return;
      }

      if (section === 'health' && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_OVERVIEW');
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            health: container.db.all(
              'SELECT component, status, coverage_level, checked_at, error_details FROM monitoring_health WHERE guild_id = ? ORDER BY checked_at DESC LIMIT 40',
              [guildId],
            ),
            scans: container.staffDiscovery.listScanHistory(guildId, 10),
          },
        });
        return;
      }

      if (section === 'tickets' && parts[4] === 'search' && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_TICKETS');
        const query = asString(ctx.url.searchParams.get('q'), 80).trim();
        const limit = Math.min(50, Math.max(1, asNumber(ctx.url.searchParams.get('limit'), 20)));
        if (!query) throw new HttpError(400, 'Enter a ticket number to search.');
        const result = container.tickets.listTickets(guildId, { search: query, pageSize: limit });
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            query,
            total: result.total,
            tickets: result.items.map((t) => ticketDto(container, guildId, t as never)),
            canViewTranscripts: access.localScopes.has('SERVER_VIEW_TRANSCRIPTS'),
          },
        });
        return;
      }

      if (section === 'tickets' && !parts[4] && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_TICKETS');
        const { page, pageSize } = pagination(ctx.url, 25);
        const statusRaw = asString(ctx.url.searchParams.get('status'), 200);
        const statusGroups: Record<string, string[]> = {
          OPEN: ['OPEN'],
          UNCLAIMED: [],
          CLAIMED: ['CLAIMED', 'ASSIGNED'],
          ACTIVE: ['OPEN', 'CLAIMED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'],
          WAITING_STAFF: ['OPEN', 'REOPENED'],
          WAITING_CREATOR: ['IN_PROGRESS'],
          RESOLVED: ['RESOLVED'],
          CLOSED: ['CLOSED'],
          REOPENED: ['REOPENED'],
        };
        const statuses = statusGroups[statusRaw] ?? (statusRaw ? statusRaw.split(',').filter(Boolean) : undefined);
        const claimRaw = asString(ctx.url.searchParams.get('claim'), 20).toUpperCase();
        const claim =
          claimRaw === 'UNCLAIMED' || claimRaw === 'CLAIMED' || claimRaw === 'AUTOMATIC' || claimRaw === 'MANUAL'
            ? (claimRaw as 'UNCLAIMED' | 'CLAIMED' | 'AUTOMATIC' | 'MANUAL')
            : 'ALL';
        const result = container.tickets.listTickets(guildId, {
          statuses: statuses as never,
          claim,
          assignedTo: asString(ctx.url.searchParams.get('assignedTo'), 30) || undefined,
          search: asString(ctx.url.searchParams.get('search'), 80) || undefined,
          categoryId: asString(ctx.url.searchParams.get('categoryId'), 30) || undefined,
          fromIso: asString(ctx.url.searchParams.get('from'), 30) || undefined,
          toIso: asString(ctx.url.searchParams.get('to'), 30) || undefined,
          page,
          pageSize,
        });
        const staff = container.roster.listStaffProfiles(guildId, { onlyActiveStaff: true });
        const categories = container.tickets.listTicketChannelConfigs(guildId, 'CATEGORY');
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            tickets: result.items.map((t) => ticketDto(container, guildId, t as never)),
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            canViewTranscripts: access.localScopes.has('SERVER_VIEW_TRANSCRIPTS'),
            canManageTickets: access.localScopes.has('SERVER_MANAGE_TICKETS'),
            filterOptions: {
              staff: staff.map((s) => ({ user_id: s.user_id, display_name: s.display_name })),
              categories: categories.map((c) => ({ id: c.channel_id, name: c.channel_name })),
            },
          },
        });
        return;
      }

      if (section === 'tickets' && parts[4] && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_TICKETS');
        const detail = container.tickets.getTicketDetail(guildId, parts[4]);
        if (!detail) throw new HttpError(404, 'Ticket not found in this server.');
        const canTranscript = access.localScopes.has('SERVER_VIEW_TRANSCRIPTS');
        if (canTranscript) {
          container.audit.log({
            guildId,
            actorUserId: access.userId,
            actionCategory: 'TICKET',
            actionType: 'TICKET_TRANSCRIPT_ACCESSED',
            targetType: 'TICKET',
            targetId: parts[4],
            metadata: { surface: 'website' },
          });
        }
        const timer = container.autoClaim.getPendingTimer(parts[4]);
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            ticket: ticketDto(container, guildId, detail.ticket as never),
            messages: canTranscript
              ? detail.messages.map((m) => ({
                  message_id: m.message_id,
                  author_user_id: m.author_user_id,
                  author_name: m.author_name,
                  author_type: m.author_type,
                  content: m.content,
                  content_available: m.content_available,
                  attachment_count: m.attachment_count,
                  attachments: JSON.parse(m.attachments_json || '[]'),
                  is_edited: m.is_edited,
                  is_deleted: m.is_deleted,
                  sent_at: m.sent_at,
                }))
              : [],
            transcriptDenied: !canTranscript,
            events: detail.events.map((e) => ({
              event_type: e.event_type,
              actor_user_id: e.actor_user_id,
              actor_name: staffName(container, guildId, e.actor_user_id),
              details: safeJson(e.details_json),
              occurred_at: e.occurred_at,
            })),
            assignments: detail.assignments.map((a) => ({
              staff_user_id: a.staff_user_id,
              staff_name: staffName(container, guildId, a.staff_user_id),
              assignment_type: a.assignment_type,
              assigned_by: a.assigned_by,
              assigned_at: a.assigned_at,
              unassigned_at: a.unassigned_at,
              is_current: a.is_current,
            })),
            pendingAutoClaim: timer
              ? { execute_at: timer.execute_at, first_responder: timer.first_responder_user_id }
              : null,
            permissions: {
              canManageTickets: access.localScopes.has('SERVER_MANAGE_TICKETS'),
              canViewTranscripts: canTranscript,
            },
          },
        });
        return;
      }

      if (section === 'tickets' && parts[4] && parts[5] && method === 'POST') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_TICKETS');
        const ticketId = parts[4];
        const action = parts[5];
        const name = ctx.session!.username;

        if (action === 'claim') {
          if (!access.isActiveStaff) throw new HttpError(403, 'Only active staff members can claim tickets.');
          container.tickets.claimTicket({ guildId, ticketId, staffUserId: access.userId, claimType: 'MANUAL' });
        } else if (action === 'unclaim') {
          const ticket = container.tickets.getTicketById(guildId, ticketId);
          if (!ticket) throw new HttpError(404, 'Ticket not found.');
          if (ticket.claimed_by_user_id !== access.userId) {
            container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'WEB_TICKET_UNCLAIM');
          }
          const now = new Date().toISOString();
          container.db.transaction(() => {
            container.db.run(
              `UPDATE ticket_records SET claimed_by_user_id = NULL, assigned_to_user_id = NULL,
                 claim_type = NULL, claim_at = NULL,
                 status = CASE WHEN status = 'CLAIMED' THEN 'OPEN' ELSE status END, updated_at = ?
               WHERE guild_id = ? AND ticket_id = ?`,
              [now, guildId, ticketId],
            );
            container.db.run(
              `UPDATE ticket_assignments SET is_current = 0, unassigned_at = ? WHERE guild_id = ? AND ticket_id = ? AND is_current = 1`,
              [now, guildId, ticketId],
            );
            container.db.run(
              `INSERT INTO ticket_events (ticket_id, guild_id, actor_user_id, event_type, details_json, occurred_at)
               VALUES (?, ?, ?, 'OWNERSHIP_CHANGED', ?, ?)`,
              [ticketId, guildId, access.userId, JSON.stringify({ action: 'UNCLAIMED', surface: 'web' }), now],
            );
          });
        } else if (action === 'assign' || action === 'reassign') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'WEB_TICKET_ASSIGN');
          const body = bodyObject(ctx);
          const staffUserId = asString(body.staffUserId, 30);
          if (!staffUserId || !container.roster.isActiveStaffMember(guildId, staffUserId)) {
            throw new HttpError(400, 'Select an active staff member.');
          }
          container.tickets.assignOrReassignTicket({
            guildId,
            ticketId,
            staffUserId,
            actorUserId: access.userId,
          });
        } else if (action === 'close') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'WEB_TICKET_CLOSE');
          container.tickets.closeTicket({ guildId, ticketId, actorUserId: access.userId });
        } else if (action === 'reopen') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'WEB_TICKET_REOPEN');
          container.tickets.reopenTicket({ guildId, ticketId, actorUserId: access.userId });
        } else if (action === 'resolve') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'WEB_TICKET_RESOLVE');
          container.tickets.resolveTicket({ guildId, ticketId, staffUserId: access.isActiveStaff ? access.userId : null });
        } else {
          throw new HttpError(400, `Unknown ticket action "${action}".`);
        }

        container.audit.log({
          guildId,
          actorUserId: access.userId,
          actorTag: name,
          actionCategory: 'TICKET',
          actionType: `WEB_TICKET_${action.toUpperCase()}`,
          targetType: 'TICKET',
          targetId: ticketId,
        });
        const updated = container.tickets.getTicketById(guildId, ticketId);
        sendJson(ctx.res, 200, {
          ok: true,
          data: { ticket: updated ? ticketDto(container, guildId, updated as never) : null },
        });
        return;
      }

      if (section === 'ticket-analytics' && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_ANALYTICS');
        const summary = container.tickets.getGuildTicketSummary(guildId);
        const claimTypes = container.db.all<{ claim_type: string; cnt: number }>(
          `SELECT COALESCE(claim_type,'NONE') AS claim_type, COUNT(*) AS cnt FROM ticket_records
           WHERE guild_id = ? GROUP BY COALESCE(claim_type,'NONE')`,
          [guildId],
        );
        const responseByStaff = container.db.all<{
          first_response_staff_id: string;
          cnt: number;
          avg_sec: number | null;
          min_sec: number | null;
        }>(
          `SELECT first_response_staff_id, COUNT(*) AS cnt, AVG(first_response_sec) AS avg_sec, MIN(first_response_sec) AS min_sec
           FROM ticket_records WHERE guild_id = ? AND first_response_staff_id IS NOT NULL
           GROUP BY first_response_staff_id ORDER BY avg_sec ASC LIMIT 50`,
          [guildId],
        );
        const resolutionByStaff = container.db.all<{
          resolved_by_user_id: string;
          cnt: number;
          avg_sec: number | null;
        }>(
          `SELECT resolved_by_user_id, COUNT(*) AS cnt, AVG(resolution_sec) AS avg_sec
           FROM ticket_records WHERE guild_id = ? AND resolved_by_user_id IS NOT NULL AND resolution_sec IS NOT NULL
           GROUP BY resolved_by_user_id ORDER BY avg_sec ASC LIMIT 50`,
          [guildId],
        );
        const daily = container.db.all<{
          stat_date: string;
          tickets_opened: number;
          tickets_resolved: number;
          avg_first_response_sec: number | null;
        }>(
          `SELECT stat_date, tickets_opened, tickets_resolved, avg_first_response_sec
           FROM daily_statistics WHERE guild_id = ? ORDER BY stat_date DESC LIMIT 30`,
          [guildId],
        );
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            summary,
            claimTypes,
            responseByStaff: responseByStaff.map((r) => ({ ...r, staff_name: staffName(container, guildId, r.first_response_staff_id) })),
            resolutionByStaff: resolutionByStaff.map((r) => ({ ...r, staff_name: staffName(container, guildId, r.resolved_by_user_id) })),
            daily: [...daily].reverse(),
          },
        });
        return;
      }

      if (section === 'staff' && parts[4] && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId);
        const targetId = parts[4];
        const isSelf = targetId === access.userId;
        if (!isSelf) container.authz.assertLocalScope(access, 'SERVER_VIEW_STAFF', 'WEB_STAFF_PROFILE');
        if (isSelf && !access.localScopes.has('SERVER_VIEW_STAFF') && !access.localScopes.has('STAFF_SELF_VIEW')) {
          throw new HttpError(403, 'You may not view staff profiles in this server.');
        }
        const profile = container.roster.getStaffProfile(guildId, targetId);
        if (!profile) throw new HttpError(404, 'Staff profile not found.');
        const activity = container.db.all(
          'SELECT event_type, is_qualifying, classification_reason, occurred_at, ticket_id FROM activity_events WHERE guild_id = ? AND user_id = ? ORDER BY occurred_at DESC LIMIT 25',
          [guildId, targetId],
        );
        const warnings = isSelf
          ? container.warnings.listWarnings(guildId, { staffUserId: targetId, limit: 25 })
          : container.warnings.listWarnings(guildId, { staffUserId: targetId, limit: 25 });
        const leave = container.leave.listGuildLeave(guildId, { staffUserId: targetId, limit: 10 });
        const roleHistory = container.roster.getRoleHistory(guildId, targetId, 20);
        const tickets = container.db.all<{ ticket_id: string; ticket_number: string | null; status: string; opened_at: string; claim_type: string | null }>(
          `SELECT ticket_id, ticket_number, status, opened_at, claim_type FROM ticket_records
           WHERE guild_id = ? AND (assigned_to_user_id = ? OR first_response_staff_id = ?)
           ORDER BY opened_at DESC LIMIT 10`,
          [guildId, targetId, targetId],
        );
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            profile: staffDto(container, guildId, profile as never),
            activity,
            warnings: warnings.map((w) => ({
              warning_id: w.warning_id,
              warning_level: w.warning_level,
              status: w.status,
              reason: w.reason,
              approved_at: w.approved_at,
              removed_reason: w.removed_reason,
            })),
            leave,
            roleHistory: roleHistory.map((h) => ({ change_type: h.change_type, detected_at: h.detected_at })),
            tickets,
            isSelf,
          },
        });
        return;
      }

      if (section === 'staff' && !parts[4] && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_STAFF');
        const status = asString(ctx.url.searchParams.get('status'), 40) || undefined;
        const search = asString(ctx.url.searchParams.get('search'), 80).toLowerCase();
        const { page, pageSize } = pagination(ctx.url, 50);
        let staff = container.roster.listStaffProfiles(guildId, {
          onlyActiveStaff: ctx.url.searchParams.get('includeFormer') === 'true' ? false : true,
          status: status as StaffMonitoringStatus | undefined,
        });
        if (search) {
          staff = staff.filter((s) => s.username.toLowerCase().includes(search) || s.display_name.toLowerCase().includes(search) || s.user_id === search);
        }
        const total = staff.length;
        const items = staff.slice((page - 1) * pageSize, page * pageSize);
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            staff: items.map((s) => staffDto(container, guildId, s as never)),
            total,
            page,
            pageSize,
            statuses: ['ACTIVE', 'AT_RISK', 'INACTIVE', 'ON_LEAVE', 'NEW_STAFF', 'INSUFFICIENT_WORKLOAD', 'MONITORING_ERROR', 'UNKNOWN'],
          },
        });
        return;
      }

      if (section === 'activity' && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_STAFF');
        const userId = asString(ctx.url.searchParams.get('userId'), 30);
        const limit = Math.min(100, Math.max(1, asNumber(ctx.url.searchParams.get('limit'), 50)));
        const rows: Array<Record<string, unknown>> = userId
          ? container.db.all<Record<string, unknown>>(
              'SELECT user_id, event_type, is_qualifying, classification_reason, occurred_at, ticket_id, channel_id FROM activity_events WHERE guild_id = ? AND user_id = ? ORDER BY occurred_at DESC LIMIT ?',
              [guildId, userId, limit],
            )
          : container.db.all<Record<string, unknown>>(
              'SELECT user_id, event_type, is_qualifying, classification_reason, occurred_at, ticket_id, channel_id FROM activity_events WHERE guild_id = ? ORDER BY occurred_at DESC LIMIT ?',
              [guildId, limit],
            );
        sendJson(ctx.res, 200, {
          ok: true,
          data: {
            events: rows.map((r) => ({
              ...r,
              staff_name: staffName(container, guildId, String(r.user_id)),
            })),
          },
        });
        return;
      }

      if (section === 'analytics' && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_ANALYTICS');
        const { periodType } = parsePeriod(ctx.url.searchParams.get('period'));
        const targetStaff = asString(ctx.url.searchParams.get('staffId'), 30) || undefined;
        try {
          const report = container.analytics.buildGuildAnalytics(guildId, {
            periodType,
            targetStaffUserId: targetStaff,
          });
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              report,
              staff: report.staffRows.map((s) => ({
                ...s,
                staff_name: staffName(container, guildId, s.userId),
              })),
            },
          });
        } catch (err) {
          throw new HttpError(400, err instanceof Error ? err.message : 'Analytics unavailable.');
        }
        return;
      }

      if (section === 'reviews') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_REVIEWS');
        if (!parts[4] && method === 'GET') {
          const pendingOnly = ctx.url.searchParams.get('pendingOnly') !== 'false';
          const reviews = container.reviews.listGuildReviews(guildId, { pendingOnly, limit: 100 });
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              reviews: reviews.map((r) => ({
                review_id: r.review_id,
                guild_id: r.guild_id,
                staff_user_id: r.staff_user_id,
                staff_name: staffName(container, guildId, r.staff_user_id),
                status: r.status,
                required_policy: r.required_policy,
                suggested_level: r.suggested_level,
                proposed_reason: r.proposed_reason,
                snapshot: safeJson(r.snapshot_json),
                created_at: r.created_at,
                updated_at: r.updated_at,
                deferred_until: r.deferred_until,
              })),
            },
          });
          return;
        }
        if (parts[4] && parts[5] && method === 'POST') {
          const reviewId = parts[4];
          const action = parts[5];
          const body = bodyObject(ctx);
          const ctxActor = toActor(access, ctx.session!.username);
          if (action === 'approve') {
            const res = await container.reviews.initiateWarningApproval(ctxActor, reviewId, {
              proposedReason: asString(body.reason, 500) || undefined,
              proposedNote: asString(body.note, 500) || undefined,
              actorDisplayName: ctx.session!.username,
            });
            sendJson(ctx.res, 200, {
              ok: true,
              data: {
                stage: res.stage,
                message: res.message,
                review: {
                  review_id: res.review.review_id,
                  staff_user_id: res.review.staff_user_id,
                  suggested_level: res.review.suggested_level,
                  proposed_reason: res.review.proposed_reason,
                },
              },
            });
            return;
          }
          if (action === 'confirm') {
            const res = await container.reviews.finalizeWarningConfirmation(ctxActor, reviewId, ctx.session!.username);
            sendJson(ctx.res, 200, { ok: true, data: { warning: res.warning ?? null, autoCancelledReason: res.autoCancelledReason ?? null } });
            return;
          }
          if (action === 'reject') {
            const review = container.reviews.rejectReview(ctxActor, reviewId, ctx.session!.username, asString(body.note, 500) || undefined);
            sendJson(ctx.res, 200, { ok: true, data: { review } });
            return;
          }
          if (action === 'later') {
            const review = container.reviews.deferReviewLater(ctxActor, reviewId, Math.min(168, Math.max(1, asNumber(body.hours, 12))), asString(body.note, 500) || undefined);
            sendJson(ctx.res, 200, { ok: true, data: { review } });
            return;
          }
          if (action === 'cancel') {
            const reason = asString(body.reason, 500);
            if (!reason) throw new HttpError(400, 'A cancellation reason is required.');
            const review = await container.reviews.cancelReviewByCommand(ctxActor, reviewId, reason);
            sendJson(ctx.res, 200, { ok: true, data: { review } });
            return;
          }
          if (action === 'excuse') {
            const review = container.reviews.markReviewExcused(ctxActor, reviewId, ctx.session!.username, asString(body.note, 500) || 'Excused from website');
            sendJson(ctx.res, 200, { ok: true, data: { review } });
            return;
          }
          throw new HttpError(400, `Unknown review action "${action}".`);
        }
      }

      if (section === 'warnings') {
        const isSelfContext = parts[4] === 'self';
        if (!parts[4] && method === 'GET') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_STAFF');
          const userId = asString(ctx.url.searchParams.get('userId'), 30) || undefined;
          const warnings = container.warnings.listWarnings(guildId, { staffUserId: userId, limit: 100 });
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              warnings: warnings.map((w) => ({
                ...w,
                staff_name: staffName(container, guildId, w.staff_user_id),
              })),
              canManage: access.localScopes.has('SERVER_MANAGE_WARNINGS'),
            },
          });
          return;
        }
        if (!parts[4] && method === 'POST') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_WARNINGS');
          const body = bodyObject(ctx);
          const staffUserId = asString(body.staffUserId, 30);
          const reason = asString(body.reason, 1000).trim();
          if (!staffUserId || !container.roster.getStaffProfile(guildId, staffUserId)) throw new HttpError(400, 'Select a registered staff member.');
          if (reason.length < 3) throw new HttpError(400, 'Warning reason is required.');
          const warning = await container.warnings.issueWarning({
            guildId,
            staffUserId,
            reason,
            managementNote: asString(body.note, 500) || null,
            issuedById: access.userId,
            approverId: access.userId,
            approverDisplayName: ctx.session!.username,
            explicitLevel: [1, 2, 3].includes(Number(body.level)) ? (Number(body.level) as 1 | 2 | 3) : undefined,
          });
          sendJson(ctx.res, 201, { ok: true, data: { warning } });
          return;
        }
        if (parts[4] && method === 'DELETE') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_WARNINGS');
          const body = bodyObject(ctx);
          const reason = asString(body.reason, 500).trim();
          if (reason.length < 3) throw new HttpError(400, 'A removal reason is required.');
          const warning = container.warnings.removeWarning({
            guildId,
            warningId: parts[4],
            actorUserId: access.userId,
            removalReason: reason,
          });
          sendJson(ctx.res, 200, { ok: true, data: { warning } });
          return;
        }
        if (isSelfContext) throw new HttpError(405, 'Unsupported warnings route.');
      }

      if (section === 'appeals') {
        if (!parts[4] && method === 'GET') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_APPEALS');
          const status = asString(ctx.url.searchParams.get('status'), 20).toUpperCase() as 'PENDING' | 'APPROVED' | 'REJECTED' | '';
          const appeals = container.warnings.listAppeals(guildId, status || undefined, 100);
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              appeals: appeals.map((a) => ({ ...a, staff_name: staffName(container, guildId, a.staff_user_id) })),
              canManage: access.localScopes.has('SERVER_MANAGE_APPEALS'),
            },
          });
          return;
        }
        if (parts[4] === 'submit' && method === 'POST') {
          const access = await requireGuild(ctx, deps, guildId);
          const body = bodyObject(ctx);
          const warningId = asString(body.warningId, 60);
          const warning = container.warnings.getWarningById(guildId, warningId);
          if (!warning) throw new HttpError(404, 'Warning not found.');
          if (warning.staff_user_id !== access.userId) throw new HttpError(403, 'You can only appeal your own warnings.');
          const appeal = container.warnings.submitAppeal({
            guildId,
            warningId,
            staffUserId: access.userId,
            appealReason: asString(body.reason, 1000),
          });
          sendJson(ctx.res, 201, { ok: true, data: { appeal } });
          return;
        }
        if (parts[4] && parts[5] && method === 'POST') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_APPEALS');
          const body = bodyObject(ctx);
          const decision = parts[5] === 'approve' ? 'APPROVED' : parts[5] === 'reject' ? 'REJECTED' : null;
          if (!decision) throw new HttpError(400, 'Unknown appeal decision.');
          const appeal = container.warnings.decideAppeal({
            guildId,
            appealId: parts[4],
            actorUserId: access.userId,
            actorDisplayName: ctx.session!.username,
            decision,
            decisionNote: asString(body.note, 500) || `Appeal ${decision.toLowerCase()} from dashboard`,
          });
          sendJson(ctx.res, 200, { ok: true, data: { appeal } });
          return;
        }
      }

      if (section === 'leave') {
        if (!parts[4] && method === 'GET') {
          const access = await requireGuild(ctx, deps, guildId);
          const canManage = access.localScopes.has('SERVER_MANAGE_LEAVE') || access.isServerOwner;
          const onlySelf = !canManage;
          if (onlySelf && !access.localScopes.has('STAFF_SELF_VIEW')) {
            throw new HttpError(403, 'You do not have access to leave records.');
          }
          const all = container.leave.listGuildLeave(guildId, { limit: 100 });
          const visible = onlySelf ? all.filter((l) => l.staff_user_id === access.userId) : all;
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              leave: visible.map((l) => ({ ...l, staff_name: staffName(container, guildId, l.staff_user_id) })),
              canManage,
            },
          });
          return;
        }
        if (parts[4] === 'request' && method === 'POST') {
          const access = await requireGuild(ctx, deps, guildId);
          const body = bodyObject(ctx);
          const staffUserId = asString(body.staffUserId, 30) || access.userId;
          if (staffUserId !== access.userId) {
            container.authz.assertLocalScope(access, 'SERVER_MANAGE_LEAVE', 'WEB_LEAVE_REQUEST_OTHER');
          }
          if (!container.roster.getStaffProfile(guildId, staffUserId)) throw new HttpError(400, 'That member has no staff profile.');
          const leave = container.leave.submitLeaveRequest({
            guildId,
            staffUserId,
            requestedById: access.userId,
            reason: asString(body.reason, 1000),
            startAt: asString(body.startAt, 40),
            endAt: asString(body.endAt, 40),
          });
          sendJson(ctx.res, 201, { ok: true, data: { leave } });
          return;
        }
        if (parts[4] && parts[5] && method === 'POST') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_LEAVE');
          const body = bodyObject(ctx);
          if (parts[5] === 'approve') {
            const leave = container.leave.approveLeave(guildId, parts[4], access.userId, asString(body.note, 500) || undefined);
            sendJson(ctx.res, 200, { ok: true, data: { leave } });
            return;
          }
          if (parts[5] === 'reject') {
            const leave = container.leave.rejectLeave(guildId, parts[4], access.userId, asString(body.reason, 500) || 'Rejected from dashboard');
            sendJson(ctx.res, 200, { ok: true, data: { leave } });
            return;
          }
          throw new HttpError(400, 'Unknown leave action.');
        }
      }

      if (section === 'staff-roles') {
        if (method === 'GET') {
          await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_STAFF');
          const [dRoles, configured] = await Promise.all([
            deps.provider.listRoles(guildId),
            Promise.resolve(container.roster.listStaffRoles(guildId)),
          ]);
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              discordRoles: dRoles,
              configured: configured.map((r) => ({
                role_id: r.role_id,
                role_name: r.role_name,
                category: r.category,
                is_monitored: r.is_monitored,
                custom_at_risk_hours: r.custom_at_risk_hours,
                custom_inactive_hours: r.custom_inactive_hours,
                custom_escalation_hours: r.custom_escalation_hours,
                created_at: r.created_at,
              })),
              categories: ['TRIAL_STAFF', 'JUNIOR_STAFF', 'STAFF', 'SENIOR_STAFF', 'SUPPORT_TEAM', 'HELPER', 'MODERATOR', 'SENIOR_MODERATOR', 'ADMINISTRATOR', 'MANAGEMENT', 'CO_OWNER', 'CUSTOM'],
            },
          });
          return;
        }
        if (method === 'POST' && parts[4] === 'scan') {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_STAFF');
          const body = bodyObject(ctx);
          const roles = asStringArray(body.roleIds);
          if (roles.length === 0) throw new HttpError(400, 'Select at least one role to scan.');
          const configured = container.roster.listStaffRoles(guildId);
          const selected = roles.map((roleId) => ({
            roleId,
            roleName: configured.find((c) => c.role_id === roleId)?.role_name ?? roleId,
          }));
          const members = await deps.provider.searchMembers(guildId, '', 1000);
          container.audit.log({
            guildId,
            actorUserId: access.userId,
            actionCategory: 'ROSTER',
            actionType: 'WEB_STAFF_ROLE_SCAN_REQUESTED',
            metadata: { roles },
          });
          // Only cached members are visible through the web provider; scan honestly reports coverage.
          const report = container.staffDiscovery.discoverMembers(
            guildId,
            access.userId,
            selected,
            members.map((m) => ({
              userId: m.id,
              username: m.username,
              displayName: m.displayName,
              roleIds: m.roles,
              isBot: false,
            })),
            { coverageLevel: 'PARTIAL', fetchWarning: 'Website scans use the Discord cache. Run /staff sync in Discord for a full member fetch.' },
          );
          sendJson(ctx.res, 200, { ok: true, data: { report } });
          return;
        }
        if (method === 'POST' && !parts[4]) {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_STAFF');
          const body = bodyObject(ctx);
          const roleId = asString(body.roleId, 30);
          const roleName = asString(body.roleName, 100) || roleId;
          const category = asString(body.category, 40) || 'STAFF';
          const saved = container.roster.addOrUpdateStaffRole(guildId, access.userId, {
            roleId,
            roleName,
            category: category as StaffRoleCategory,
          });
          sendJson(ctx.res, 201, { ok: true, data: { role: saved } });
          return;
        }
        if (method === 'DELETE' && parts[4]) {
          const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_STAFF');
          const removed = container.roster.removeStaffRole(guildId, access.userId, parts[4]);
          sendJson(ctx.res, 200, { ok: true, data: { removed } });
          return;
        }
      }

      if (section === 'members' && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_ROLES');
        const query = asString(ctx.url.searchParams.get('q'), 80);
        const members = await deps.provider.searchMembers(guildId, query, 25);
        sendJson(ctx.res, 200, { ok: true, data: { members } });
        return;
      }

      if (section === 'roles' && method === 'GET') {
        await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_ROLES');
        const roles = await deps.provider.listRoles(guildId);
        sendJson(ctx.res, 200, { ok: true, data: { roles } });
        return;
      }

      if (section === 'access') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_MANAGE_ROLES');
        const actor = container.authz.toRoleActor(access, ctx.session!.username);

        if (!parts[4] && method === 'GET') {
          const assignments = container.webRoles.listAssignments({ guildId, includeInactive: true });
          const legacy = container.permissions.listGuildPermissionAssignments(guildId);
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              assignments,
              legacy,
              assignableRoles: access.isGlobalOwner || access.isServerOwner
                ? ['SERVER_CO_OWNER', 'SERVER_ADMIN', 'SERVER_VIEWER', 'STAFF_VIEWER']
                : [...(GRANTABLE_ROLES[access.actorKind as WebRole] ?? [])],
              roleTemplates: ['SERVER_CO_OWNER', 'SERVER_ADMIN', 'SERVER_VIEWER', 'STAFF_VIEWER', 'GLOBAL_ADMIN'].map((role) => ({
                role,
                label: WEB_ROLE_LABELS[role as WebRole],
                defaultPermissions: ROLE_DEFAULT_SCOPES[role as WebRole],
                allowedPermissions: ROLE_ALLOWED_SCOPES[role as WebRole],
                grantableHere: role === 'GLOBAL_ADMIN' ? access.isGlobalOwner : true,
              })),
              matrix: PERMISSION_MATRIX,
              actorKind: access.actorKind,
              isServerOwner: access.isServerOwner,
            },
          });
          return;
        }
        if (!parts[4] && method === 'POST') {
          const body = bodyObject(ctx);
          const role = asString(body.role, 40) as WebRole;
          if (!isWebRole(role)) throw new HttpError(400, 'Unknown website role.');
          const targetUserId = asString(body.userId, 30);
          if (!targetUserId) throw new HttpError(400, 'Select a Discord member.');
          if (targetUserId === access.userId) {
            throw new HttpError(400, 'Self-promotion is blocked. Your own access cannot be granted or escalated from this panel.');
          }
          if (role !== 'GLOBAL_ADMIN' && !(await deps.provider.isMemberOfGuild(guildId, targetUserId))) {
            throw new HttpError(400, 'That user is not a member of this Discord server.');
          }
          const assignment = container.webRoles.assignRole(actor, {
            targetUserId,
            targetUsername: asString(body.username, 80) || targetUserId,
            guildId,
            role,
            permissions: asStringArray(body.permissions),
            expiresAt: asString(body.expiresAt, 40) || null,
            reason: asString(body.reason, 500) || null,
          });
          sendJson(ctx.res, 201, { ok: true, data: { assignment } });
          return;
        }
        if (parts[4] && method === 'PATCH') {
          const body = bodyObject(ctx);
          const assignment = container.webRoles.updateAssignment(actor, parts[4], {
            permissions: Array.isArray(body.permissions) ? asStringArray(body.permissions) : undefined,
            expiresAt: body.expiresAt === null ? null : asString(body.expiresAt, 40) || undefined,
            reason: asString(body.reason, 500) || null,
          });
          sendJson(ctx.res, 200, { ok: true, data: { assignment } });
          return;
        }
        if (parts[4] && method === 'DELETE') {
          const body = bodyObject(ctx);
          const assignment = container.webRoles.revokeAssignment(actor, parts[4], asString(body.reason, 500) || 'Revoked from Access & Roles');
          sendJson(ctx.res, 200, { ok: true, data: { assignment } });
          return;
        }
        if (parts[4] && parts[5] && method === 'POST') {
          if (parts[5] === 'suspend') {
            const assignment = container.webRoles.suspendAssignment(actor, parts[4], asString(bodyObject(ctx).reason, 500) || null);
            sendJson(ctx.res, 200, { ok: true, data: { assignment } });
            return;
          }
          if (parts[5] === 'resume') {
            const assignment = container.webRoles.resumeAssignment(actor, parts[4], asString(bodyObject(ctx).reason, 500) || null);
            sendJson(ctx.res, 200, { ok: true, data: { assignment } });
            return;
          }
        }
      }

      if (section === 'settings') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_OVERVIEW');
        if (method === 'GET') {
          const cfg = container.guildConfig.getGuildConfigOrThrow(guildId);
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              guild: {
                id: cfg.guild_id,
                name: cfg.guild_name,
                ownerId: cfg.owner_id,
                alertChannelId: cfg.alert_channel_id,
                logChannelId: cfg.log_channel_id,
                fallbackReviewChannelId: cfg.fallback_review_channel_id,
                supportWorkChannelIds: safeJson(cfg.support_work_channel_ids_json),
                atRiskHours: cfg.at_risk_hours,
                inactiveHours: cfg.inactive_hours,
                escalationHours: cfg.escalation_hours,
                observationBaselineHours: cfg.observation_baseline_hours,
                scanIntervalMinutes: cfg.scan_interval_minutes,
                warningExpiryDays: cfg.warning_expiry_days,
                approvalPolicyOverride: cfg.approval_policy_override,
                baselineCompletedAt: cfg.baseline_completed_at,
              },
              features: container.features.listGuildFeatures(guildId),
              canManage: access.localScopes.has('SERVER_MANAGE_SETTINGS'),
              globalSettings: {
                autoClaimMinutes: container.settings.getNumber('ticket_auto_claim_minutes'),
                retentionDays: container.settings.getNumber('ticket_message_retention_days'),
              },
            },
          });
          return;
        }
        if (method === 'PATCH') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_SETTINGS', 'WEB_SETTINGS_UPDATE');
          const body = bodyObject(ctx);
          const updated = container.guildConfig.updateInactivityThresholds(guildId, access.userId, {
            atRiskHours: body.atRiskHours !== undefined ? asNumber(body.atRiskHours, 24) : undefined,
            inactiveHours: body.inactiveHours !== undefined ? asNumber(body.inactiveHours, 48) : undefined,
            escalationHours: body.escalationHours !== undefined ? asNumber(body.escalationHours, 72) : undefined,
            observationBaselineHours: body.observationBaselineHours !== undefined ? asNumber(body.observationBaselineHours, 24) : undefined,
            scanIntervalMinutes: body.scanIntervalMinutes !== undefined ? asNumber(body.scanIntervalMinutes, 360) : undefined,
          });
          if (body.alertChannelId !== undefined || body.logChannelId !== undefined || body.fallbackReviewChannelId !== undefined) {
            container.guildConfig.updateGuildChannels(guildId, access.userId, {
              alertChannelId: body.alertChannelId === null ? null : asString(body.alertChannelId, 30) || undefined,
              logChannelId: body.logChannelId === null ? null : asString(body.logChannelId, 30) || undefined,
              fallbackReviewChannelId: body.fallbackReviewChannelId === null ? null : asString(body.fallbackReviewChannelId, 30) || undefined,
            });
          }
          if (Array.isArray(body.features)) {
            for (const raw of body.features) {
              if (!raw || typeof raw !== 'object') continue;
              const f = raw as Record<string, unknown>;
              const key = asString(f.key, 60);
              if (typeof f.enabled === 'boolean') {
                container.features.setGuildFeature(guildId, access.userId, key as never, f.enabled);
              }
            }
          }
          container.scheduler.initializeSchedules();
          sendJson(ctx.res, 200, { ok: true, data: { thresholds: updated } });
          return;
        }
      }

      if (section === 'integrations') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_TICKETS');
        if (!parts[4] && method === 'GET') {
          const configs = container.db.all(
            'SELECT id, integration_type, external_name, is_active, config_json, created_at, updated_at FROM integration_configs WHERE guild_id = ? ORDER BY created_at ASC',
            [guildId],
          );
          sendJson(ctx.res, 200, {
            ok: true,
            data: {
              integrations: configs.map((c) => {
                const row = c as Record<string, unknown>;
                return {
                  id: row.id,
                  integration_type: row.integration_type,
                  external_name: row.external_name,
                  is_active: row.is_active,
                  config: safeJson(String(row.config_json ?? '{}')),
                  created_at: row.created_at,
                  updated_at: row.updated_at,
                };
              }),
              adapters: container.tickets.adapterRegistry.listAll().map((a) => ({
                id: a.id,
                displayName: a.displayName,
                supportedEvents: a.supportedEvents,
                limitations: a.limitations,
              })),
              ticketChannels: container.tickets.listTicketChannelConfigs(guildId).map((c) => ({
                id: c.channel_id,
                name: c.channel_name,
                targetType: c.target_type,
                adapter: c.adapter_type,
              })),
              canManage: access.localScopes.has('SERVER_MANAGE_INTEGRATIONS'),
            },
          });
          return;
        }
        if (!parts[4] && method === 'POST') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_INTEGRATIONS', 'WEB_INTEGRATION_SETUP');
          const body = bodyObject(ctx);
          const type = asString(body.type, 40);
          if (!['ticket-tool', 'tickets-v2', 'custom', 'webhook', 'discord'].includes(type)) throw new HttpError(400, 'Unknown integration type.');
          const id = `INT-${Date.now().toString(36).toUpperCase()}`;
          const now = new Date().toISOString();
          const config = body.config && typeof body.config === 'object' ? body.config : {};
          container.db.run(
            `INSERT INTO integration_configs (id, guild_id, integration_type, external_name, is_active, config_json, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [id, guildId, type, asString(body.name, 80) || type, JSON.stringify(config), access.userId, now, now],
          );
          sendJson(ctx.res, 201, { ok: true, data: { id } });
          return;
        }
        if (parts[4] && method === 'DELETE') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_INTEGRATIONS', 'WEB_INTEGRATION_DELETE');
          const changes = container.db.run('DELETE FROM integration_configs WHERE guild_id = ? AND id = ?', [guildId, parts[4]]).changes;
          sendJson(ctx.res, 200, { ok: true, data: { removed: changes > 0 } });
          return;
        }
        if (parts[4] && parts[5] === 'test' && method === 'POST') {
          container.authz.assertLocalScope(access, 'SERVER_MANAGE_INTEGRATIONS', 'WEB_INTEGRATION_TEST');
          const report = container.tickets.runDiagnostics(guildId, undefined, container.config.enableMessageContentIntent);
          sendJson(ctx.res, 200, { ok: true, data: { report } });
          return;
        }
      }

      if (section === 'reports') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_ANALYTICS');
        if (!parts[4] && method === 'GET') {
          const { periodType } = parsePeriod(ctx.url.searchParams.get('period'));
          const report = container.analytics.buildGuildAnalytics(guildId, { periodType });
          sendJson(ctx.res, 200, { ok: true, data: { report, canExport: access.localScopes.has('SERVER_EXPORT_REPORTS') } });
          return;
        }
        if (parts[4] === 'export' && method === 'GET') {
          container.authz.assertLocalScope(access, 'SERVER_EXPORT_REPORTS', 'WEB_REPORT_EXPORT');
          const { periodType } = parsePeriod(ctx.url.searchParams.get('period'));
          const format = (asString(ctx.url.searchParams.get('format'), 10) || 'csv').toLowerCase();
          const report = container.analytics.buildGuildAnalytics(guildId, { periodType });
          if (format === 'csv') {
            const buffer = container.reportExporter.exportGuildCsvReport(report);
            sendJson(ctx.res, 200, { ok: true, data: { format, base64: buffer.toString('base64'), filename: `tanveer-report-${guildId}.csv` } });
            return;
          }
          if (format === 'png') {
            const buffer = container.reportExporter.exportGuildPngReport(report);
            sendJson(ctx.res, 200, { ok: true, data: { format, base64: buffer.toString('base64'), filename: `tanveer-report-${guildId}.png` } });
            return;
          }
          if (format === 'pdf') {
            const buffer = await container.reportExporter.exportGuildPdfReport(report);
            sendJson(ctx.res, 200, { ok: true, data: { format, base64: buffer.toString('base64'), filename: `tanveer-report-${guildId}.pdf` } });
            return;
          }
          throw new HttpError(400, 'Unsupported export format.');
        }
      }

      if (section === 'audit' && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_AUDIT');
        const limit = Math.min(200, Math.max(1, asNumber(ctx.url.searchParams.get('limit'), 50)));
        const logs = container.audit.listGuildLogs(guildId, {
          category: asString(ctx.url.searchParams.get('category'), 40) || undefined,
          limit,
        });
        sendJson(ctx.res, 200, { ok: true, data: { logs, canViewTranscriptAudit: access.localScopes.has('SERVER_VIEW_AUDIT') } });
        return;
      }

      if (section === 'notifications' && method === 'GET') {
        const access = await requireGuild(ctx, deps, guildId, 'SERVER_VIEW_OVERVIEW');
        const notifications = container.db.all(
          `SELECT notification_id, notification_type, title, summary, delivery_channel, delivered, is_read, created_at
           FROM notification_history WHERE guild_id = ? AND recipient_user_id = ? ORDER BY created_at DESC LIMIT 50`,
          [guildId, access.userId],
        );
        sendJson(ctx.res, 200, { ok: true, data: { notifications } });
        return;
      }
    }

    throw new HttpError(404, 'API endpoint not found.');
  }
}

function isMutatingMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function toHttpError(err: unknown): { status: number; message: string } {
  if (err instanceof HttpError) return { status: err.status, message: err.message };
  const anyErr = err as { statusCode?: number; message?: string };
  const message = anyErr?.message ?? 'Unexpected server error.';
  if (anyErr?.statusCode && anyErr.statusCode >= 400 && anyErr.statusCode < 500) {
    return { status: anyErr.statusCode, message };
  }
  if (/^Access Denied|^Unauthorized/i.test(message)) {
    return { status: 403, message };
  }
  if (/unsafe|invalid|required|not found|denied|forbidden|cannot|must|blocked|rejected|already/i.test(message)) {
    return { status: 400, message };
  }
  return { status: 500, message: 'An unexpected error occurred. The operation was not applied.' };
}
