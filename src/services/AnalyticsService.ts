import { IRelationalDatabase } from '../database/connection';
import { isPermanentGlobalOwner } from '../config/branding';
import { MonitoringCoverageLevel, StaffMonitoringStatus } from '../config/theme';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { RosterService } from './RosterService';
import { TicketService } from './TicketService';

export type ReportPeriodType = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'CUSTOM';

export interface StaffFairPerformanceRow {
  userId: string;
  username: string;
  displayName: string;
  primaryCategory: string;
  monitoringStatus: StaffMonitoringStatus;
  monitoringCoverage: MonitoringCoverageLevel;
  ticketsAssigned: number;
  ticketsHandled: number;
  ticketsResolved: number;
  reopenedTickets: number;
  firstResponseSec: number | null;
  avgResponseSec: number | null;
  avgResolutionSec: number | null;
  currentWorkload: number;
  recentActivity7d: number;
  longTermActivity30d: number;
  workConsistencyPct: number;
  fairnessNote: string;
  activeWarnings: number;
}

export interface GuildAnalyticsReport {
  reportScope: 'SERVER' | 'STAFF_INDIVIDUAL';
  periodType: ReportPeriodType;
  guildId: string;
  guildName: string;
  fromIso: string;
  toIso: string;
  generatedAt: string;
  coverageLevel: MonitoringCoverageLevel;
  statusBreakdown: Record<StaffMonitoringStatus, number>;
  ticketMetrics: {
    openedInPeriod: number;
    handledInPeriod: number;
    resolvedInPeriod: number;
    reopenedTotal: number;
    avgFirstResponseSec: number | null;
    avgResolutionSec: number | null;
    availableWorkload: number;
  };
  warningMetrics: {
    level1Active: number;
    level2Active: number;
    level3Active: number;
    issuedInPeriod: number;
  };
  reviewOutcomes: {
    pending: number;
    approved: number;
    rejected: number;
    excused: number;
    cancelled: number;
  };
  staffRows: StaffFairPerformanceRow[];
}

export interface GlobalAnalyticsReport {
  generatedAt: string;
  fromIso: string;
  toIso: string;
  totalGuilds: number;
  totalStaff: number;
  statusBreakdown: Record<StaffMonitoringStatus, number>;
  totalTicketsMonitored: number;
  totalTicketsHandled: number;
  totalTicketsResolved: number;
  pendingReviews: number;
  totalWarnings: number;
  monitoringErrors: number;
  guildSummaries: Array<{
    guildId: string;
    guildName: string;
    staffCount: number;
    activeCount: number;
    inactiveCount: number;
    ticketsTotal: number;
    pendingReviews: number;
    warningsActive: number;
  }>;
}

export class AnalyticsService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly roster: RosterService;
  private readonly tickets: TicketService;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    roster: RosterService,
    tickets: TicketService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.roster = roster;
    this.tickets = tickets;
  }

  public resolvePeriodRange(
    periodType: ReportPeriodType,
    customFromIso?: string,
    customToIso?: string,
    nowIso = new Date().toISOString(),
  ): { fromIso: string; toIso: string } {
    const endMs = customToIso ? Date.parse(customToIso) : Date.parse(nowIso);
    if (!Number.isFinite(endMs)) {
      throw new Error('Invalid report end date.');
    }

    if (periodType === 'CUSTOM') {
      if (!customFromIso) {
        throw new Error('Custom date-range reports require a valid start date (YYYY-MM-DD).');
      }
      const startMs = Date.parse(customFromIso);
      if (!Number.isFinite(startMs) || startMs > endMs) {
        throw new Error('Invalid custom date range: start date must precede end date.');
      }
      return { fromIso: new Date(startMs).toISOString(), toIso: new Date(endMs).toISOString() };
    }

    const days = periodType === 'DAILY' ? 1 : periodType === 'WEEKLY' ? 7 : 30;
    const startMs = endMs - days * 86_400_000;
    return {
      fromIso: new Date(startMs).toISOString(),
      toIso: new Date(endMs).toISOString(),
    };
  }

  public buildGuildAnalytics(
    guildId: string,
    options?: {
      periodType?: ReportPeriodType;
      customFromIso?: string;
      customToIso?: string;
      targetStaffUserId?: string;
      nowIso?: string;
    },
  ): GuildAnalyticsReport {
    const guildCfg = this.guildConfig.getGuildConfigOrThrow(guildId);
    if (!this.features.isEnabled(guildId, 'analytics')) {
      throw new Error('Analytics engine is currently disabled in server feature settings.');
    }

    const nowIso = options?.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const periodType = options?.periodType ?? 'WEEKLY';
    const { fromIso, toIso } = this.resolvePeriodRange(
      periodType,
      options?.customFromIso,
      options?.customToIso,
      nowIso,
    );

    const allStaff = this.roster.listStaffProfiles(guildId, { onlyActiveStaff: true });
    const filteredStaff = options?.targetStaffUserId
      ? allStaff.filter((s) => s.user_id === options.targetStaffUserId)
      : allStaff;

    const statusBreakdown: Record<StaffMonitoringStatus, number> = {
      ACTIVE: 0,
      AT_RISK: 0,
      INACTIVE: 0,
      ON_LEAVE: 0,
      UNKNOWN: 0,
      NEW_STAFF: 0,
      INSUFFICIENT_WORKLOAD: 0,
      MONITORING_ERROR: 0,
    };
    for (const s of allStaff) {
      statusBreakdown[s.monitoring_status] = (statusBreakdown[s.monitoring_status] ?? 0) + 1;
    }

    const ticketPeriodRow = this.db.get<{
      opened_cnt: number;
      resolved_cnt: number;
      reopen_sum: number | null;
      avg_first: number | null;
      avg_res: number | null;
    }>(
      `SELECT
        SUM(CASE WHEN opened_at >= ? AND opened_at <= ? THEN 1 ELSE 0 END) AS opened_cnt,
        SUM(CASE WHEN resolved_at >= ? AND resolved_at <= ? THEN 1 ELSE 0 END) AS resolved_cnt,
        SUM(reopened_count) AS reopen_sum,
        AVG(first_response_sec) AS avg_first,
        AVG(resolution_sec) AS avg_res
      FROM ticket_records
      WHERE guild_id = ?`,
      [fromIso, toIso, fromIso, toIso, guildId],
    );

    const handledInPeriodRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(DISTINCT ticket_id) AS cnt
       FROM ticket_events
       WHERE guild_id = ? AND event_type IN ('FIRST_RESPONSE','STAFF_RESPONSE','RESOLVED')
         AND occurred_at >= ? AND occurred_at <= ?`,
      [guildId, fromIso, toIso],
    );

    const availableWorkload = this.tickets.countAvailableGuildWorkload(guildId, fromIso);

    const warnDist = this.db.get<{
      l1: number;
      l2: number;
      l3: number;
      in_period: number;
    }>(
      `SELECT
        SUM(CASE WHEN status = 'ACTIVE' AND warning_level = 1 THEN 1 ELSE 0 END) AS l1,
        SUM(CASE WHEN status = 'ACTIVE' AND warning_level = 2 THEN 1 ELSE 0 END) AS l2,
        SUM(CASE WHEN status = 'ACTIVE' AND warning_level = 3 THEN 1 ELSE 0 END) AS l3,
        SUM(CASE WHEN approved_at >= ? AND approved_at <= ? THEN 1 ELSE 0 END) AS in_period
       FROM warnings
       WHERE guild_id = ?`,
      [fromIso, toIso, guildId],
    );

    const reviewDist = this.db.get<{
      pending_cnt: number;
      approved_cnt: number;
      rejected_cnt: number;
      excused_cnt: number;
      cancelled_cnt: number;
    }>(
      `SELECT
        SUM(CASE WHEN status IN ('PENDING','DEFERRED','AWAITING_SECOND_APPROVAL','AWAITING_CONFIRMATION') THEN 1 ELSE 0 END) AS pending_cnt,
        SUM(CASE WHEN status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_cnt,
        SUM(CASE WHEN status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_cnt,
        SUM(CASE WHEN status = 'EXCUSED' THEN 1 ELSE 0 END) AS excused_cnt,
        SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_cnt
       FROM warning_reviews
       WHERE guild_id = ?`,
      [guildId],
    );

    const sevenDaysAgoIso = new Date(nowMs - 7 * 86_400_000).toISOString();
    const thirtyDaysAgoIso = new Date(nowMs - 30 * 86_400_000).toISOString();

    // Days in the last 30 days where the server actually had qualifying work opportunities
    const serverWorkDaysRow = this.db.get<{ days_cnt: number }>(
      `SELECT COUNT(DISTINCT substr(occurred_at, 1, 10)) AS days_cnt
       FROM activity_events
       WHERE guild_id = ? AND is_qualifying = 1 AND occurred_at >= ?`,
      [guildId, thirtyDaysAgoIso],
    );
    const activeOpportunityDays = Math.max(1, serverWorkDaysRow?.days_cnt ?? 1);

    const staffRows: StaffFairPerformanceRow[] = filteredStaff.map((s) => {
      const act7Row = this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM activity_events
         WHERE guild_id = ? AND user_id = ? AND is_qualifying = 1 AND occurred_at >= ?`,
        [guildId, s.user_id, sevenDaysAgoIso],
      );
      const act30Row = this.db.get<{ cnt: number; active_days: number }>(
        `SELECT COUNT(*) AS cnt, COUNT(DISTINCT substr(occurred_at, 1, 10)) AS active_days
         FROM activity_events
         WHERE guild_id = ? AND user_id = ? AND is_qualifying = 1 AND occurred_at >= ?`,
        [guildId, s.user_id, thirtyDaysAgoIso],
      );
      const reopenedForStaff = this.db.get<{ reopen_sum: number | null }>(
        `SELECT SUM(reopened_count) AS reopen_sum FROM ticket_records
         WHERE guild_id = ? AND assigned_to_user_id = ?`,
        [guildId, s.user_id],
      );

      const staffActiveDays = act30Row?.active_days ?? 0;
      const consistencyPct =
        availableWorkload === 0 && staffActiveDays === 0
          ? 100
          : Math.min(100, Math.round((staffActiveDays / activeOpportunityDays) * 100));

      let fairnessNote = 'Balanced workload & active monitoring';
      if (s.monitoring_status === 'ON_LEAVE') {
        fairnessNote = 'Protected: Approved Leave (Exempt from inactivity scoring)';
      } else if (s.monitoring_status === 'INSUFFICIENT_WORKLOAD' || (availableWorkload === 0 && s.tickets_handled_count === 0)) {
        fairnessNote = 'Fairness-Adjusted: Zero unassigned workload available';
      } else if (s.monitoring_status === 'NEW_STAFF') {
        fairnessNote = 'Observation Baseline: Newly onboarded staff member';
      } else if (s.monitoring_coverage !== 'FULL') {
        fairnessNote = `Coverage ${s.monitoring_coverage}: Partial visibility`;
      }

      return {
        userId: s.user_id,
        username: s.username,
        displayName: s.display_name,
        primaryCategory: s.primary_category,
        monitoringStatus: s.monitoring_status,
        monitoringCoverage: s.monitoring_coverage,
        ticketsAssigned: s.assigned_tickets_count,
        ticketsHandled: s.tickets_handled_count,
        ticketsResolved: s.tickets_resolved_count,
        reopenedTickets: reopenedForStaff?.reopen_sum ?? 0,
        firstResponseSec: s.avg_first_response_sec,
        avgResponseSec: s.avg_response_sec,
        avgResolutionSec: s.avg_resolution_sec,
        currentWorkload: s.current_workload,
        recentActivity7d: act7Row?.cnt ?? 0,
        longTermActivity30d: act30Row?.cnt ?? 0,
        workConsistencyPct: consistencyPct,
        fairnessNote,
        activeWarnings: s.active_warnings_count,
      };
    });

    const ticketConfigs = this.tickets.listTicketChannelConfigs(guildId);
    const overallCoverage: MonitoringCoverageLevel =
      allStaff.some((s) => s.monitoring_coverage === 'PARTIAL')
        ? 'PARTIAL'
        : ticketConfigs.length > 0 || allStaff.some((s) => s.monitoring_coverage === 'FULL')
          ? 'FULL'
          : 'UNAVAILABLE';

    return {
      reportScope: options?.targetStaffUserId ? 'STAFF_INDIVIDUAL' : 'SERVER',
      periodType,
      guildId,
      guildName: guildCfg.guild_name,
      fromIso,
      toIso,
      generatedAt: nowIso,
      coverageLevel: overallCoverage,
      statusBreakdown,
      ticketMetrics: {
        openedInPeriod: ticketPeriodRow?.opened_cnt ?? 0,
        handledInPeriod: handledInPeriodRow?.cnt ?? 0,
        resolvedInPeriod: ticketPeriodRow?.resolved_cnt ?? 0,
        reopenedTotal: ticketPeriodRow?.reopen_sum ?? 0,
        avgFirstResponseSec: ticketPeriodRow?.avg_first ?? null,
        avgResolutionSec: ticketPeriodRow?.avg_res ?? null,
        availableWorkload,
      },
      warningMetrics: {
        level1Active: warnDist?.l1 ?? 0,
        level2Active: warnDist?.l2 ?? 0,
        level3Active: warnDist?.l3 ?? 0,
        issuedInPeriod: warnDist?.in_period ?? 0,
      },
      reviewOutcomes: {
        pending: reviewDist?.pending_cnt ?? 0,
        approved: reviewDist?.approved_cnt ?? 0,
        rejected: reviewDist?.rejected_cnt ?? 0,
        excused: reviewDist?.excused_cnt ?? 0,
        cancelled: reviewDist?.cancelled_cnt ?? 0,
      },
      staffRows,
    };
  }

  public buildGlobalAnalytics(
    actorUserId: string,
    hasBotAdminStatsScope = false,
    nowIso = new Date().toISOString(),
  ): GlobalAnalyticsReport {
    if (!isPermanentGlobalOwner(actorUserId) && !hasBotAdminStatsScope) {
      throw new Error('Forbidden: Global analytics are restricted to the Permanent Global Owner.');
    }

    const guilds = this.guildConfig.listAllGuilds();
    const statusBreakdown: Record<StaffMonitoringStatus, number> = {
      ACTIVE: 0,
      AT_RISK: 0,
      INACTIVE: 0,
      ON_LEAVE: 0,
      UNKNOWN: 0,
      NEW_STAFF: 0,
      INSUFFICIENT_WORKLOAD: 0,
      MONITORING_ERROR: 0,
    };

    const allStaffRows = this.db.all<{ monitoring_status: StaffMonitoringStatus; cnt: number }>(
      `SELECT monitoring_status, COUNT(*) AS cnt
       FROM staff_profiles WHERE is_currently_staff = 1
       GROUP BY monitoring_status`,
    );
    let totalStaff = 0;
    for (const r of allStaffRows) {
      statusBreakdown[r.monitoring_status] = r.cnt;
      totalStaff += r.cnt;
    }

    const ticketTotals = this.db.get<{
      monitored: number;
      handled: number;
      resolved: number;
    }>(
      `SELECT
        COUNT(*) AS monitored,
        SUM(CASE WHEN meaningful_response_count > 0 THEN 1 ELSE 0 END) AS handled,
        SUM(CASE WHEN status IN ('RESOLVED','CLOSED') AND resolved_by_user_id IS NOT NULL THEN 1 ELSE 0 END) AS resolved
       FROM ticket_records`,
    );

    const pendingReviewsRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM warning_reviews
       WHERE status IN ('PENDING','DEFERRED','AWAITING_SECOND_APPROVAL','AWAITING_CONFIRMATION')`,
    );
    const totalWarningsRow = this.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM warnings');
    const healthErrorsRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM monitoring_health WHERE status = 'ERROR'`,
    );

    const guildSummaries = guilds.map((g) => {
      const sRow = this.db.get<{ total: number; act: number; inact: number }>(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN monitoring_status = 'ACTIVE' THEN 1 ELSE 0 END) AS act,
          SUM(CASE WHEN monitoring_status = 'INACTIVE' THEN 1 ELSE 0 END) AS inact
         FROM staff_profiles WHERE guild_id = ? AND is_currently_staff = 1`,
        [g.guild_id],
      );
      const tRow = this.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM ticket_records WHERE guild_id = ?', [
        g.guild_id,
      ]);
      const rRow = this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM warning_reviews
         WHERE guild_id = ? AND status IN ('PENDING','DEFERRED','AWAITING_SECOND_APPROVAL','AWAITING_CONFIRMATION')`,
        [g.guild_id],
      );
      const wRow = this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM warnings WHERE guild_id = ? AND status = 'ACTIVE'`,
        [g.guild_id],
      );

      return {
        guildId: g.guild_id,
        guildName: g.guild_name,
        staffCount: sRow?.total ?? 0,
        activeCount: sRow?.act ?? 0,
        inactiveCount: sRow?.inact ?? 0,
        ticketsTotal: tRow?.cnt ?? 0,
        pendingReviews: rRow?.cnt ?? 0,
        warningsActive: wRow?.cnt ?? 0,
      };
    });

    const thirtyDaysAgo = new Date(Date.parse(nowIso) - 30 * 86_400_000).toISOString();

    return {
      generatedAt: nowIso,
      fromIso: thirtyDaysAgo,
      toIso: nowIso,
      totalGuilds: guilds.length,
      totalStaff,
      statusBreakdown,
      totalTicketsMonitored: ticketTotals?.monitored ?? 0,
      totalTicketsHandled: ticketTotals?.handled ?? 0,
      totalTicketsResolved: ticketTotals?.resolved ?? 0,
      pendingReviews: pendingReviewsRow?.cnt ?? 0,
      totalWarnings: totalWarningsRow?.cnt ?? 0,
      monitoringErrors: healthErrorsRow?.cnt ?? 0,
      guildSummaries,
    };
  }
}
