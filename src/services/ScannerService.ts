import { IRelationalDatabase } from '../database/connection';
import { MonitoringCoverageLevel, StaffMonitoringStatus } from '../config/theme';
import { InactivityIncidentRecord, InactivitySeverity } from '../types/domain';
import { ChannelPermissionCheck } from '../tickets/ITicketAdapter';
import { formatDurationHours, generateEntityId } from '../utils/ids';
import { AuditService } from './AuditService';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { LeaveService } from './LeaveService';
import { ReviewService } from './ReviewService';
import { GuildMemberSnapshot, RosterService } from './RosterService';
import { TicketService } from './TicketService';
import { WarningService } from './WarningService';

export interface ScanGuildOptions {
  trigger: 'SCHEDULED' | 'MANUAL';
  actorUserId?: string;
  nowIso?: string;
  liveMembers?: readonly GuildMemberSnapshot[];
  livePermissionChecks?: readonly ChannelPermissionCheck[];
  roleHoldersMap?: ReadonlyMap<string, readonly string[]>;
  monitoringSystemDown?: boolean;
  monitoringErrorReason?: string;
}

export interface GuildScanReport {
  guildId: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  scannedAt: string;
  coverageLevel: MonitoringCoverageLevel;
  totalStaffScanned: number;
  statusCounts: Record<StaffMonitoringStatus, number>;
  incidentsCreatedOrUpdated: number;
  escalationsTriggered: number;
  reviewsCreated: number;
  reviewsCancelled: number;
  skippedByLock: boolean;
}

export class ScannerService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly roster: RosterService;
  private readonly tickets: TicketService;
  private readonly leave: LeaveService;
  private readonly warnings: WarningService;
  private readonly reviews: ReviewService;
  private readonly audit: AuditService;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    roster: RosterService,
    tickets: TicketService,
    leave: LeaveService,
    warnings: WarningService,
    reviews: ReviewService,
    audit: AuditService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.roster = roster;
    this.tickets = tickets;
    this.leave = leave;
    this.warnings = warnings;
    this.reviews = reviews;
    this.audit = audit;
  }

  public tryAcquireLock(lockName: string, holderId: string, ttlSeconds = 300, nowIso = new Date().toISOString()): boolean {
    const nowMs = Date.parse(nowIso);
    const expiresIso = new Date(nowMs + ttlSeconds * 1000).toISOString();

    return this.db.transaction(() => {
      const existing = this.db.get<{
        lock_name: string;
        holder_id: string | null;
        expires_at: string | null;
      }>('SELECT lock_name, holder_id, expires_at FROM scheduler_locks WHERE lock_name = ?', [lockName]);

      if (existing && existing.holder_id && existing.expires_at && existing.expires_at > nowIso) {
        return false;
      }

      this.db.run(
        `INSERT INTO scheduler_locks (lock_name, holder_id, acquired_at, expires_at, run_count)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(lock_name) DO UPDATE SET
           holder_id = excluded.holder_id,
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at`,
        [lockName, holderId, nowIso, expiresIso],
      );
      return true;
    });
  }

  public releaseLock(
    lockName: string,
    holderId: string,
    outcome: { status: 'SUCCESS' | 'ERROR'; nextRunAt?: string | null; error?: string | null },
    nowIso = new Date().toISOString(),
  ): void {
    this.db.run(
      `UPDATE scheduler_locks SET
        holder_id = NULL,
        expires_at = NULL,
        last_run_at = ?,
        next_run_at = COALESCE(?, next_run_at),
        run_count = run_count + 1,
        last_status = ?,
        last_error = ?
       WHERE lock_name = ? AND (holder_id = ? OR holder_id IS NULL)`,
      [nowIso, outcome.nextRunAt ?? null, outcome.status, outcome.error ?? null, lockName, holderId],
    );
  }

  private createEmptyStatusCounts(): Record<StaffMonitoringStatus, number> {
    return {
      ACTIVE: 0,
      AT_RISK: 0,
      INACTIVE: 0,
      ON_LEAVE: 0,
      UNKNOWN: 0,
      NEW_STAFF: 0,
      INSUFFICIENT_WORKLOAD: 0,
      MONITORING_ERROR: 0,
    };
  }

  public async scanGuildRoster(guildId: string, options: ScanGuildOptions): Promise<GuildScanReport> {
    const guildCfg = this.guildConfig.getGuildConfigOrThrow(guildId);
    const nowIso = options.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(nowIso);

    if (options.trigger === 'SCHEDULED' && !this.features.isEnabled(guildId, 'scheduled_scanning')) {
      return {
        guildId,
        trigger: options.trigger,
        scannedAt: nowIso,
        coverageLevel: 'UNAVAILABLE',
        totalStaffScanned: 0,
        statusCounts: this.createEmptyStatusCounts(),
        incidentsCreatedOrUpdated: 0,
        escalationsTriggered: 0,
        reviewsCreated: 0,
        reviewsCancelled: 0,
        skippedByLock: false,
      };
    }

    if (options.trigger === 'MANUAL' && !this.features.isEnabled(guildId, 'manual_scanning')) {
      throw new Error('Manual roster scanning is currently disabled in server feature settings.');
    }

    const lockName = `guild-scan:${guildId}`;
    const holderId = `${options.trigger}:${process.pid}:${Date.now()}`;
    if (!this.tryAcquireLock(lockName, holderId, 300, nowIso)) {
      return {
        guildId,
        trigger: options.trigger,
        scannedAt: nowIso,
        coverageLevel: 'FULL',
        totalStaffScanned: 0,
        statusCounts: this.createEmptyStatusCounts(),
        incidentsCreatedOrUpdated: 0,
        escalationsTriggered: 0,
        reviewsCreated: 0,
        reviewsCancelled: 0,
        skippedByLock: true,
      };
    }

    try {
      // 1. Optional live roster sync before scanning
      if (options.liveMembers && this.features.isEnabled(guildId, 'roster_sync')) {
        this.roster.syncGuildRoster(guildId, options.liveMembers, { nowIso });
      }

      // 2. Refresh leave lifecycle & warning expirations
      this.leave.refreshGuildLeaveLifecycle(guildId, nowIso);
      this.warnings.expireElapsedWarnings(guildId, nowIso);

      // 3. Determine monitoring coverage & system health
      const ticketConfigs = this.tickets.listTicketChannelConfigs(guildId);
      let supportChannelIds: string[] = [];
      try {
        supportChannelIds = JSON.parse(guildCfg.support_work_channel_ids_json) as string[];
      } catch {
        supportChannelIds = [];
      }

      let coverageLevel: MonitoringCoverageLevel = 'UNAVAILABLE';
      let hasMonitoringFailure = Boolean(options.monitoringSystemDown);

      if (options.monitoringSystemDown) {
        coverageLevel = 'UNAVAILABLE';
      } else if (options.livePermissionChecks && options.livePermissionChecks.length > 0) {
        const diag = this.tickets.runDiagnostics(guildId, options.livePermissionChecks);
        coverageLevel = diag.coverageLevel;
        if (diag.accessibleCount === 0 && diag.inaccessibleCount > 0) {
          hasMonitoringFailure = true;
        }
      } else if (ticketConfigs.length > 0 || supportChannelIds.length > 0) {
        coverageLevel = 'FULL';
      } else {
        coverageLevel = 'UNAVAILABLE';
      }

      const installedMs = Date.parse(guildCfg.installed_at);
      const baselineHours = guildCfg.observation_baseline_hours;
      if (
        !guildCfg.baseline_completed_at &&
        Number.isFinite(installedMs) &&
        nowMs - installedMs >= baselineHours * 3_600_000
      ) {
        this.guildConfig.markBaselineCompleted(guildId);
      }

      const staffList = this.roster.listStaffProfiles(guildId, { onlyActiveStaff: true });
      const statusCounts = this.createEmptyStatusCounts();
      let incidentsCreatedOrUpdated = 0;
      let escalationsTriggered = 0;
      let reviewsCreated = 0;
      let reviewsCancelled = 0;

      const inactivityDetectionEnabled = this.features.isEnabled(guildId, 'inactivity_detection');
      const inactivityReportsEnabled = this.features.isEnabled(guildId, 'inactivity_reports');

      for (const staff of staffList) {
        // Priority 1: Monitoring broken / system error
        if (hasMonitoringFailure) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'MONITORING_ERROR', coverageLevel, nowIso);
          statusCounts.MONITORING_ERROR += 1;
          continue;
        }

        // Priority 2: Active approved leave
        const activeLeave = this.leave.getActiveLeaveForStaff(guildId, staff.user_id, nowIso);
        if (activeLeave) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'ON_LEAVE', coverageLevel, nowIso);
          statusCounts.ON_LEAVE += 1;
          reviewsCancelled += await this.reviews.cancelPendingReviewsOnWorkResumed(
            guildId,
            staff.user_id,
            `Staff member entered approved leave (${activeLeave.leave_id})`,
            nowIso,
          );
          continue;
        }

        // Compute effective reference timestamp accounting for completed leave & staff join date
        const lastLeaveEnd = this.leave.getMostRecentCompletedLeaveEnd(guildId, staff.user_id, nowIso);
        const candidateTimestamps = [
          staff.last_qualifying_work_at ? Date.parse(staff.last_qualifying_work_at) : NaN,
          lastLeaveEnd ? Date.parse(lastLeaveEnd) : NaN,
          Date.parse(staff.joined_staff_at),
        ].filter((ms) => Number.isFinite(ms));

        const referenceMs = candidateTimestamps.length > 0 ? Math.max(...candidateTimestamps) : nowMs;
        const referenceIso = new Date(referenceMs).toISOString();
        const inactivityHours = Math.max(0, (nowMs - referenceMs) / 3_600_000);
        const thresholds = this.roster.resolveThresholdsForStaff(guildId, staff);

        // Priority 3: Recent qualifying work within active window -> ACTIVE (even if coverage is partial)
        if (staff.last_qualifying_work_at && inactivityHours < thresholds.atRiskHours) {
          const cancelled = await this.reviews.cancelPendingReviewsOnWorkResumed(
            guildId,
            staff.user_id,
            `Verified active work within ${thresholds.atRiskHours}h threshold`,
            nowIso,
          );
          reviewsCancelled += cancelled;
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'ACTIVE', coverageLevel, nowIso);
          statusCounts.ACTIVE += 1;
          continue;
        }

        // Priority 4: Newly registered staff or fresh installation within observation baseline
        const joinedMs = Date.parse(staff.joined_staff_at);
        const sinceJoinHours = Number.isFinite(joinedMs) ? Math.max(0, (nowMs - joinedMs) / 3_600_000) : 0;
        if (!staff.last_qualifying_work_at && sinceJoinHours < baselineHours) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'NEW_STAFF', coverageLevel, nowIso);
          statusCounts.NEW_STAFF += 1;
          continue;
        }

        // Priority 5: Incomplete or unconfigured monitoring coverage -> UNKNOWN (never generate formal warning review!)
        if (coverageLevel !== 'FULL') {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'UNKNOWN', coverageLevel, nowIso);
          statusCounts.UNKNOWN += 1;
          continue;
        }

        // If staff just returned from leave less than atRiskHours ago, treat as ACTIVE grace window
        if (lastLeaveEnd && inactivityHours < thresholds.atRiskHours) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'ACTIVE', coverageLevel, nowIso);
          statusCounts.ACTIVE += 1;
          continue;
        }

        // Priority 6: Check available workload & work opportunities!
        // Never mark a staff member AT_RISK or INACTIVE if there was 0 workload available!
        const availableWorkload = this.tickets.countAvailableGuildWorkload(guildId, referenceIso);
        const effectiveOpportunities = Math.max(staff.current_workload, availableWorkload);

        if (effectiveOpportunities === 0) {
          this.updateStaffStatusAndCoverage(
            guildId,
            staff.user_id,
            'INSUFFICIENT_WORKLOAD',
            coverageLevel,
            nowIso,
          );
          statusCounts.INSUFFICIENT_WORKLOAD += 1;
          continue;
        }

        if (!inactivityDetectionEnabled) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'UNKNOWN', coverageLevel, nowIso);
          statusCounts.UNKNOWN += 1;
          continue;
        }

        // Priority 7: Classify AT_RISK (24h+) vs INACTIVE (48h+) vs ESCALATED (72h+)
        if (inactivityHours >= thresholds.inactiveHours) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'INACTIVE', coverageLevel, nowIso);
          statusCounts.INACTIVE += 1;

          if (inactivityReportsEnabled) {
            const isEscalated = inactivityHours >= thresholds.escalationHours;
            const severity: InactivitySeverity = isEscalated ? 'ESCALATED_72H' : 'INACTIVE_48H';
            const incident = this.upsertInactivityIncident({
              guildId,
              staffUserId: staff.user_id,
              status: isEscalated ? 'ESCALATED' : 'PENDING_REVIEW',
              severity,
              inactivityHours,
              lastQualifyingActivityAt: staff.last_qualifying_work_at,
              lastTicketActivityAt: staff.last_ticket_activity_at,
              availableWorkloadCount: effectiveOpportunities,
              monitoringCoverage: coverageLevel,
              reasonSummary: isEscalated
                ? `High-priority escalation: ${formatDurationHours(inactivityHours)} without qualifying work (${effectiveOpportunities} open workload opportunity(s), FULL coverage).`
                : `Confirmed inactivity: ${formatDurationHours(inactivityHours)} without qualifying work (${effectiveOpportunities} open workload opportunity(s), FULL coverage).`,
              nowIso,
            });
            incidentsCreatedOrUpdated += 1;
            if (isEscalated) escalationsTriggered += 1;

            const revResult = await this.reviews.createPersistentReviewForIncident(
              incident,
              options.roleHoldersMap,
              nowIso,
            );
            if (revResult.notifiedRecipients > 0 || revResult.review.created_at === nowIso) {
              reviewsCreated += 1;
            }
          }
        } else if (inactivityHours >= thresholds.atRiskHours) {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'AT_RISK', coverageLevel, nowIso);
          statusCounts.AT_RISK += 1;

          if (inactivityReportsEnabled) {
            this.upsertInactivityIncident({
              guildId,
              staffUserId: staff.user_id,
              status: 'AT_RISK',
              severity: 'AT_RISK_24H',
              inactivityHours,
              lastQualifyingActivityAt: staff.last_qualifying_work_at,
              lastTicketActivityAt: staff.last_ticket_activity_at,
              availableWorkloadCount: effectiveOpportunities,
              monitoringCoverage: coverageLevel,
              reasonSummary: `At-risk threshold reached: ${formatDurationHours(inactivityHours)} since last qualifying work.`,
              nowIso,
            });
            incidentsCreatedOrUpdated += 1;
          }
        } else {
          this.updateStaffStatusAndCoverage(guildId, staff.user_id, 'ACTIVE', coverageLevel, nowIso);
          statusCounts.ACTIVE += 1;
        }
      }

      // Record daily statistics & monitoring health
      this.recordDailySnapshot(guildId, statusCounts, reviewsCreated, nowIso);
      this.db.run(
        `INSERT INTO monitoring_health (
          guild_id, component, status, coverage_level, accessible_channels, inaccessible_channels, error_details, checked_at
        ) VALUES (?, 'SCHEDULER', ?, ?, ?, 0, ?, ?)`,
        [
          guildId,
          hasMonitoringFailure ? 'ERROR' : coverageLevel === 'FULL' ? 'HEALTHY' : 'DEGRADED',
          coverageLevel,
          ticketConfigs.length,
          options.monitoringErrorReason ?? null,
          nowIso,
        ],
      );

      this.audit.log({
        guildId,
        actorUserId: options.actorUserId ?? 'SYSTEM_SCHEDULER',
        actionCategory: 'SCANNER',
        actionType: options.trigger === 'MANUAL' ? 'MANUAL_ROSTER_SCAN_COMPLETED' : 'SCHEDULED_ROSTER_SCAN_COMPLETED',
        targetType: 'GUILD',
        targetId: guildId,
        metadata: {
          coverageLevel,
          totalStaffScanned: staffList.length,
          statusCounts,
          incidentsCreatedOrUpdated,
          escalationsTriggered,
          reviewsCreated,
          reviewsCancelled,
        },
      });

      const nextRunIso = new Date(nowMs + guildCfg.scan_interval_minutes * 60_000).toISOString();
      this.releaseLock(lockName, holderId, { status: 'SUCCESS', nextRunAt: nextRunIso }, nowIso);

      return {
        guildId,
        trigger: options.trigger,
        scannedAt: nowIso,
        coverageLevel,
        totalStaffScanned: staffList.length,
        statusCounts,
        incidentsCreatedOrUpdated,
        escalationsTriggered,
        reviewsCreated,
        reviewsCancelled,
        skippedByLock: false,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.releaseLock(lockName, holderId, { status: 'ERROR', error: msg }, nowIso);
      throw err;
    }
  }

  private updateStaffStatusAndCoverage(
    guildId: string,
    userId: string,
    status: StaffMonitoringStatus,
    coverage: MonitoringCoverageLevel,
    nowIso: string,
  ): void {
    this.db.run(
      `UPDATE staff_profiles SET monitoring_status = ?, monitoring_coverage = ?, updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
      [status, coverage, nowIso, guildId, userId],
    );
  }

  private upsertInactivityIncident(input: {
    guildId: string;
    staffUserId: string;
    status: InactivityIncidentRecord['status'];
    severity: InactivitySeverity;
    inactivityHours: number;
    lastQualifyingActivityAt: string | null;
    lastTicketActivityAt: string | null;
    availableWorkloadCount: number;
    monitoringCoverage: MonitoringCoverageLevel;
    reasonSummary: string;
    nowIso: string;
  }): InactivityIncidentRecord {
    const existing = this.db.get<InactivityIncidentRecord>(
      `SELECT * FROM inactivity_incidents
       WHERE guild_id = ? AND staff_user_id = ?
         AND status IN ('OPEN', 'AT_RISK', 'PENDING_REVIEW', 'ESCALATED')
       ORDER BY detected_at DESC LIMIT 1`,
      [input.guildId, input.staffUserId],
    );

    const suggestedLevel = this.warnings.computeNextWarningLevel(
      input.guildId,
      input.staffUserId,
      input.nowIso,
    );

    if (existing) {
      const escalatedAt =
        input.severity === 'ESCALATED_72H' ? (existing.escalated_at ?? input.nowIso) : existing.escalated_at;
      this.db.run(
        `UPDATE inactivity_incidents SET
          status = ?,
          severity = ?,
          inactivity_hours = ?,
          last_qualifying_activity_at = ?,
          last_ticket_activity_at = ?,
          available_workload_count = ?,
          monitoring_coverage = ?,
          reason_summary = ?,
          suggested_warning_level = ?,
          escalated_at = ?,
          updated_at = ?
         WHERE guild_id = ? AND incident_id = ?`,
        [
          input.status,
          input.severity,
          input.inactivityHours,
          input.lastQualifyingActivityAt,
          input.lastTicketActivityAt,
          input.availableWorkloadCount,
          input.monitoringCoverage,
          input.reasonSummary,
          suggestedLevel,
          escalatedAt,
          input.nowIso,
          input.guildId,
          existing.incident_id,
        ],
      );
      return this.db.get<InactivityIncidentRecord>(
        'SELECT * FROM inactivity_incidents WHERE incident_id = ?',
        [existing.incident_id],
      )!;
    }

    const incidentId = generateEntityId('INC');
    const escalatedAt = input.severity === 'ESCALATED_72H' ? input.nowIso : null;

    this.db.run(
      `INSERT INTO inactivity_incidents (
        incident_id, guild_id, staff_user_id, status, severity,
        inactivity_hours, last_qualifying_activity_at, last_ticket_activity_at,
        available_workload_count, monitoring_coverage, reason_summary,
        suggested_warning_level, detected_at, escalated_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        incidentId,
        input.guildId,
        input.staffUserId,
        input.status,
        input.severity,
        input.inactivityHours,
        input.lastQualifyingActivityAt,
        input.lastTicketActivityAt,
        input.availableWorkloadCount,
        input.monitoringCoverage,
        input.reasonSummary,
        suggestedLevel,
        input.nowIso,
        escalatedAt,
        input.nowIso,
      ],
    );

    return this.db.get<InactivityIncidentRecord>(
      'SELECT * FROM inactivity_incidents WHERE incident_id = ?',
      [incidentId],
    )!;
  }

  private recordDailySnapshot(
    guildId: string,
    counts: Record<StaffMonitoringStatus, number>,
    reviewsCreatedDelta: number,
    nowIso: string,
  ): void {
    const statDate = nowIso.slice(0, 10);
    const totalStaff = Object.values(counts).reduce((a, b) => a + b, 0);
    const ticketSummary = this.tickets.getGuildTicketSummary(guildId);

    const dayPrefix = `${statDate}%`;
    const warnToday = this.db.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM warnings WHERE guild_id = ? AND approved_at LIKE ?',
      [guildId, dayPrefix],
    );
    const eventsToday = this.db.get<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM activity_events WHERE guild_id = ? AND is_qualifying = 1 AND occurred_at LIKE ?',
      [guildId, dayPrefix],
    );

    this.db.run(
      `INSERT INTO daily_statistics (
        guild_id, stat_date, total_staff, active_staff, at_risk_staff, inactive_staff,
        on_leave_staff, unknown_staff, insufficient_workload_staff, error_staff,
        tickets_opened, tickets_handled, tickets_resolved, tickets_reopened,
        avg_first_response_sec, avg_resolution_sec, warnings_issued, reviews_created, qualifying_events_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(guild_id, stat_date) DO UPDATE SET
        total_staff = excluded.total_staff,
        active_staff = excluded.active_staff,
        at_risk_staff = excluded.at_risk_staff,
        inactive_staff = excluded.inactive_staff,
        on_leave_staff = excluded.on_leave_staff,
        unknown_staff = excluded.unknown_staff,
        insufficient_workload_staff = excluded.insufficient_workload_staff,
        error_staff = excluded.error_staff,
        tickets_opened = excluded.tickets_opened,
        tickets_handled = excluded.tickets_handled,
        tickets_resolved = excluded.tickets_resolved,
        tickets_reopened = excluded.tickets_reopened,
        avg_first_response_sec = excluded.avg_first_response_sec,
        avg_resolution_sec = excluded.avg_resolution_sec,
        warnings_issued = excluded.warnings_issued,
        reviews_created = daily_statistics.reviews_created + ?,
        qualifying_events_count = excluded.qualifying_events_count`,
      [
        guildId,
        statDate,
        totalStaff,
        counts.ACTIVE,
        counts.AT_RISK,
        counts.INACTIVE,
        counts.ON_LEAVE,
        counts.UNKNOWN,
        counts.INSUFFICIENT_WORKLOAD,
        counts.MONITORING_ERROR,
        ticketSummary.totalTickets,
        ticketSummary.inProgressTickets + ticketSummary.resolvedTickets + ticketSummary.closedTickets,
        ticketSummary.resolvedTickets + ticketSummary.closedTickets,
        ticketSummary.reopenedTickets,
        ticketSummary.avgFirstResponseSec,
        ticketSummary.avgResolutionSec,
        warnToday?.cnt ?? 0,
        reviewsCreatedDelta,
        eventsToday?.cnt ?? 0,
        reviewsCreatedDelta,
      ],
    );
  }

  public listGuildIncidents(guildId: string, openOnly = false, limit = 25): InactivityIncidentRecord[] {
    if (openOnly) {
      return this.db.all<InactivityIncidentRecord>(
        `SELECT * FROM inactivity_incidents
         WHERE guild_id = ? AND status IN ('OPEN','AT_RISK','PENDING_REVIEW','ESCALATED')
         ORDER BY updated_at DESC LIMIT ?`,
        [guildId, limit],
      );
    }
    return this.db.all<InactivityIncidentRecord>(
      'SELECT * FROM inactivity_incidents WHERE guild_id = ? ORDER BY updated_at DESC LIMIT ?',
      [guildId, limit],
    );
  }

  public listGlobalIncidents(openOnly = true, limit = 25): InactivityIncidentRecord[] {
    if (openOnly) {
      return this.db.all<InactivityIncidentRecord>(
        `SELECT * FROM inactivity_incidents
         WHERE status IN ('OPEN','AT_RISK','PENDING_REVIEW','ESCALATED')
         ORDER BY updated_at DESC LIMIT ?`,
        [limit],
      );
    }
    return this.db.all<InactivityIncidentRecord>(
      'SELECT * FROM inactivity_incidents ORDER BY updated_at DESC LIMIT ?',
      [limit],
    );
  }
}
