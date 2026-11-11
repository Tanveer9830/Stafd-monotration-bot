import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { IRelationalDatabase } from '../database/connection';
import { isPermanentGlobalOwner } from '../config/branding';
import { emojis } from '../config/emojis';
import { COVERAGE_DISPLAY_LABELS, MonitoringCoverageLevel } from '../config/theme';
import {
  APPROVAL_POLICY_LABELS,
  InactivityIncidentRecord,
  ReviewSnapshotData,
  WarningRecord,
  WarningReviewRecord,
} from '../types/domain';
import { attachBannerAsset, createBrandEmbed } from '../utils/embeds';
import { formatDiscordTimestamp, formatDurationHours, generateEntityId } from '../utils/ids';
import { ActivityClassifierService } from './ActivityClassifierService';
import { AuditService } from './AuditService';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { LeaveService } from './LeaveService';
import { NotificationService } from './NotificationService';
import { ActorGuildContext, PermissionService } from './PermissionService';
import { RosterService } from './RosterService';
import { TicketService } from './TicketService';
import { formatWarningLevelLabel, WarningService } from './WarningService';

export interface CaseValidityCheckResult {
  valid: boolean;
  autoCancel: boolean;
  reason?: string;
}

export class ReviewService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly permissions: PermissionService;
  private readonly roster: RosterService;
  private readonly tickets: TicketService;
  private readonly leave: LeaveService;
  private readonly warnings: WarningService;
  private readonly notifications: NotificationService;
  private readonly audit: AuditService;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    permissions: PermissionService,
    roster: RosterService,
    tickets: TicketService,
    leave: LeaveService,
    warnings: WarningService,
    notifications: NotificationService,
    classifier: ActivityClassifierService,
    audit: AuditService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.permissions = permissions;
    this.roster = roster;
    this.tickets = tickets;
    this.leave = leave;
    this.warnings = warnings;
    this.notifications = notifications;
    this.audit = audit;

    // Automatically cancel obsolete pending reviews the instant qualifying work resumes
    classifier.onQualifyingWork((guildId, userId, occurredAt, eventType) => {
      void this.cancelPendingReviewsOnWorkResumed(
        guildId,
        userId,
        `Qualifying staff work resumed (${eventType} at ${occurredAt})`,
      );
    });
  }

  public buildReviewButtons(reviewId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tsm:rev:approve:${reviewId}`)
        .setLabel('APPROVE WARNING')
        .setStyle(ButtonStyle.Danger)
        .setEmoji(emojis.forComponent('approval'))
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`tsm:rev:reject:${reviewId}`)
        .setLabel('REJECT')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.forComponent('rejection'))
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`tsm:rev:later:${reviewId}`)
        .setLabel('REVIEW LATER')
        .setStyle(ButtonStyle.Primary)
        .setEmoji(emojis.forComponent('loading'))
        .setDisabled(disabled),
      new ButtonBuilder()
        .setCustomId(`tsm:rev:excuse:${reviewId}`)
        .setLabel('MARK EXCUSED')
        .setStyle(ButtonStyle.Success)
        .setEmoji(emojis.forComponent('security'))
        .setDisabled(disabled),
    );
  }

  public buildFinalConfirmationButtons(reviewId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tsm:rev:confirm:${reviewId}`)
        .setLabel('FINAL CONFIRM — ISSUE WARNING')
        .setStyle(ButtonStyle.Danger)
        .setEmoji(emojis.forComponent('warning')),
      new ButtonBuilder()
        .setCustomId(`tsm:rev:abort:${reviewId}`)
        .setLabel('Abort Confirmation')
        .setStyle(ButtonStyle.Secondary),
    );
  }

  public buildReviewEmbed(review: WarningReviewRecord, snapshot: ReviewSnapshotData): EmbedBuilder {
    return createBrandEmbed({
      title: `${emojis.get('warning')} Staff Inactivity Review Request — \`${review.review_id}\``,
      tone: snapshot.inactivityHours >= 72 ? 'danger' : 'warning',
      subtitle: snapshot.guildName,
      description:
        `Human management approval is required before any warning is issued.\n` +
        `**Approval Policy:** ${APPROVAL_POLICY_LABELS[review.required_policy]}\n` +
        `**Current Review Status:** \`${review.status}\``,
    }).addFields(
      {
        name: 'Staff Member',
        value: `${snapshot.staffDisplayName} (@${snapshot.staffUsername})\nID: \`${snapshot.staffUserId}\``,
        inline: true,
      },
      { name: 'Server Name', value: `${snapshot.guildName}\n(\`${snapshot.guildId}\`)`, inline: true },
      {
        name: 'Configured Staff Roles',
        value: snapshot.staffRoles.length > 0 ? snapshot.staffRoles.join(', ') : 'Monitored Staff',
        inline: true,
      },
      {
        name: 'Last Qualifying Activity',
        value: formatDiscordTimestamp(snapshot.lastQualifyingActivityAt, 'R'),
        inline: true,
      },
      {
        name: 'Last Ticket Activity',
        value: formatDiscordTimestamp(snapshot.lastTicketActivityAt, 'R'),
        inline: true,
      },
      {
        name: 'Inactivity Duration',
        value: `**${formatDurationHours(snapshot.inactivityHours)}**`,
        inline: true,
      },
      {
        name: 'Ticket Performance',
        value: `Assigned: **${snapshot.assignedTickets}** | Handled: **${snapshot.ticketsHandled}** | Resolved: **${snapshot.ticketsResolved}**`,
        inline: false,
      },
      {
        name: 'Available Workload',
        value: `${snapshot.availableWorkload} active/open ticket opportunity(s)`,
        inline: true,
      },
      {
        name: 'Monitoring Coverage',
        value: COVERAGE_DISPLAY_LABELS[snapshot.monitoringCoverage],
        inline: true,
      },
      {
        name: 'Warning History',
        value: `Active: **${snapshot.activeWarningsCount}/3** (Total: ${snapshot.totalWarningsCount})`,
        inline: true,
      },
      {
        name: 'Suggested Warning Level',
        value: `**${formatWarningLevelLabel(snapshot.suggestedWarningLevel)}**`,
        inline: true,
      },
      {
        name: 'Reason for Review',
        value: snapshot.reasonForReview,
        inline: false,
      },
    );
  }

  /**
   * Creates a persistent inactivity warning review request (only when coverage is FULL and evidence is reliable),
   * deduplicates recipients (ALWAYS including Global Owner 1131248987173814336), and dispatches notifications.
   */
  public async createPersistentReviewForIncident(
    incident: InactivityIncidentRecord,
    roleHoldersMap: ReadonlyMap<string, readonly string[]> = new Map(),
    nowIso = new Date().toISOString(),
  ): Promise<{ review: WarningReviewRecord; notifiedRecipients: number }> {
    if (incident.monitoring_coverage !== 'FULL') {
      throw new Error(
        `Safety Block: Refusing to create formal warning review from incomplete coverage (${incident.monitoring_coverage}).`,
      );
    }

    const existingOpen = this.db.get<WarningReviewRecord>(
      `SELECT * FROM warning_reviews
       WHERE guild_id = ? AND staff_user_id = ?
         AND status IN ('PENDING', 'DEFERRED', 'AWAITING_SECOND_APPROVAL', 'AWAITING_CONFIRMATION')
       ORDER BY created_at DESC LIMIT 1`,
      [incident.guild_id, incident.staff_user_id],
    );

    if (existingOpen) {
      return { review: existingOpen, notifiedRecipients: 0 };
    }

    const guildCfg = this.guildConfig.getGuildConfigOrThrow(incident.guild_id);
    const profile = this.roster.getStaffProfile(incident.guild_id, incident.staff_user_id);
    if (!profile || profile.is_currently_staff === 0) {
      throw new Error('Cannot create review for non-active staff profile.');
    }

    let roleIds: string[] = [];
    try {
      roleIds = JSON.parse(profile.active_role_ids_json) as string[];
    } catch {
      roleIds = [];
    }
    const allRoles = this.roster.listStaffRoles(incident.guild_id);
    const roleNames = allRoles.filter((r) => roleIds.includes(r.role_id)).map((r) => r.role_name);

    const suggestedLevel = this.warnings.computeNextWarningLevel(incident.guild_id, incident.staff_user_id, nowIso);
    const policy = this.guildConfig.resolveEffectiveApprovalPolicy(incident.guild_id);

    const snapshot: ReviewSnapshotData = {
      staffUsername: profile.username,
      staffDisplayName: profile.display_name,
      staffUserId: profile.user_id,
      guildId: incident.guild_id,
      guildName: guildCfg.guild_name,
      staffRoles: roleNames,
      lastQualifyingActivityAt: incident.last_qualifying_activity_at,
      lastTicketActivityAt: incident.last_ticket_activity_at,
      inactivityHours: incident.inactivity_hours,
      ticketsHandled: profile.tickets_handled_count,
      ticketsResolved: profile.tickets_resolved_count,
      assignedTickets: profile.assigned_tickets_count,
      availableWorkload: incident.available_workload_count,
      monitoringCoverage: incident.monitoring_coverage,
      activeWarningsCount: profile.active_warnings_count,
      totalWarningsCount: profile.total_warnings_count,
      reasonForReview: incident.reason_summary,
      suggestedWarningLevel: suggestedLevel,
    };

    const reviewId = generateEntityId('REV');

    this.db.run(
      `INSERT INTO warning_reviews (
        review_id, incident_id, guild_id, staff_user_id, status,
        required_policy, suggested_level, snapshot_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?)`,
      [
        reviewId,
        incident.incident_id,
        incident.guild_id,
        incident.staff_user_id,
        policy,
        suggestedLevel,
        JSON.stringify(snapshot),
        nowIso,
        nowIso,
      ],
    );

    const review = this.getReviewById(incident.guild_id, reviewId)!;
    let notifiedRecipients = 0;

    if (this.features.isEnabled(incident.guild_id, 'approval_notifications')) {
      const recipients = this.permissions.resolveDeduplicatedReviewRecipients(incident.guild_id, roleHoldersMap);
      const embed = this.buildReviewEmbed(review, snapshot);
      const allowAnimated = this.features.isEnabled(incident.guild_id, 'animated_assets');
      const bannerAttachment = attachBannerAsset(embed, 'warning-approval', allowAnimated);
      const buttons = this.buildReviewButtons(reviewId);

      const dispatchRes = await this.notifications.dispatchDeduplicatedGroup({
        guildId: incident.guild_id,
        recipientUserIds: recipients,
        notificationType: 'INACTIVITY_WARNING_REVIEW',
        baseDedupKey: `review-req:${reviewId}`,
        referenceId: reviewId,
        title: `Inactivity Review Request (${reviewId})`,
        summary: `${profile.username} (${profile.user_id}) in ${guildCfg.guild_name} — ${formatDurationHours(incident.inactivity_hours)} inactive`,
        payload: {
          embeds: [embed],
          components: [buttons],
          files: bannerAttachment ? [bannerAttachment] : [],
        },
      });
      notifiedRecipients = dispatchRes.uniqueRecipientCount;
    }

    return { review, notifiedRecipients };
  }

  /**
   * Executes steps 1–6 of the Pre-Warning Approval Safety Protocol:
   * Rechecks current role, recent qualifying activity, approved leave, monitoring coverage, and workload.
   */
  public recheckCaseValidity(
    review: WarningReviewRecord,
    liveCoverageOverride?: MonitoringCoverageLevel,
    nowIso = new Date().toISOString(),
  ): CaseValidityCheckResult {
    const profile = this.roster.getStaffProfile(review.guild_id, review.staff_user_id);
    if (!profile || profile.is_currently_staff === 0) {
      return {
        valid: false,
        autoCancel: true,
        reason: 'Staff member no longer holds a configured staff role or has left the server.',
      };
    }

    // Recheck approved leave
    const activeLeave = this.leave.getActiveLeaveForStaff(review.guild_id, review.staff_user_id, nowIso);
    if (activeLeave) {
      return {
        valid: false,
        autoCancel: true,
        reason: `Staff member is currently on approved leave (${activeLeave.leave_id} until ${activeLeave.end_at}).`,
      };
    }

    // Recheck recent qualifying activity since review creation
    const thresholds = this.roster.resolveThresholdsForStaff(review.guild_id, profile);
    if (profile.last_qualifying_work_at) {
      const workMs = Date.parse(profile.last_qualifying_work_at);
      const reviewCreatedMs = Date.parse(review.created_at);
      const nowMs = Date.parse(nowIso);
      const elapsedHours = Math.max(0, (nowMs - workMs) / 3_600_000);

      if (workMs >= reviewCreatedMs || elapsedHours < thresholds.inactiveHours) {
        return {
          valid: false,
          autoCancel: true,
          reason: `Qualifying staff activity resumed (${profile.last_qualifying_work_at}; elapsed ${elapsedHours.toFixed(1)}h < ${thresholds.inactiveHours}h threshold).`,
        };
      }
    }

    // Recheck monitoring coverage
    const effectiveCoverage = liveCoverageOverride ?? profile.monitoring_coverage;
    if (effectiveCoverage !== 'FULL') {
      return {
        valid: false,
        autoCancel: false,
        reason: `Monitoring coverage is currently ${effectiveCoverage}; FULL coverage is required before issuing a warning.`,
      };
    }

    // Recheck workload / work opportunity
    let snapshotWorkload = 0;
    try {
      const snap = JSON.parse(review.snapshot_json) as ReviewSnapshotData;
      snapshotWorkload = snap.availableWorkload;
    } catch {
      snapshotWorkload = 0;
    }
    const currentWorkload = this.tickets.countAvailableGuildWorkload(review.guild_id, review.created_at);
    if (profile.current_workload === 0 && snapshotWorkload === 0 && currentWorkload === 0) {
      return {
        valid: false,
        autoCancel: false,
        reason: 'Insufficient available workload/work opportunities verified for this observation window.',
      };
    }

    return { valid: true, autoCancel: false };
  }

  /**
   * Step 1 of Approval: Validates reviewer permissions & policy, runs live safety rechecks,
   * records proposed reason/note (or records 1st of 2 approvals under dual/two-person policies),
   * and transitions to AWAITING_CONFIRMATION so final confirmation is required before issuing!
   */
  public async initiateWarningApproval(
    ctx: ActorGuildContext,
    reviewId: string,
    input?: {
      proposedReason?: string;
      proposedNote?: string;
      actorDisplayName?: string;
      nowIso?: string;
    },
  ): Promise<{
    stage: 'AWAITING_SECOND_APPROVAL' | 'AWAITING_FINAL_CONFIRMATION' | 'AUTO_CANCELLED';
    review: WarningReviewRecord;
    message: string;
  }> {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    const perms = this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'APPROVE_WARNING_REVIEW');

    if (
      review.status !== 'PENDING' &&
      review.status !== 'DEFERRED' &&
      review.status !== 'AWAITING_SECOND_APPROVAL' &&
      review.status !== 'AWAITING_CONFIRMATION'
    ) {
      throw new Error(`Review ${reviewId} has already been finalized (${review.status}).`);
    }

    const now = input?.nowIso ?? new Date().toISOString();
    const validity = this.recheckCaseValidity(review, undefined, now);
    if (!validity.valid) {
      if (validity.autoCancel) {
        const cancelled = await this.cancelReviewInternal(
          review,
          ctx.userId,
          validity.reason ?? 'Case no longer valid upon live recheck',
          now,
        );
        return {
          stage: 'AUTO_CANCELLED',
          review: cancelled,
          message: `Safety Recheck Auto-Cancelled Review: ${validity.reason}`,
        };
      }
      throw new Error(`Approval Safety Block: ${validity.reason}`);
    }

    // Enforce configured approval policy
    const policy = review.required_policy;
    const actorName = input?.actorDisplayName?.trim() || ctx.userTag || `User ${ctx.userId}`;

    if (policy === 'GLOBAL_OWNER_REQUIRED' && !perms.isGlobalOwner) {
      this.audit.log({
        guildId: ctx.guildId,
        actorUserId: ctx.userId,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'POLICY_REQUIRES_GLOBAL_OWNER',
        targetId: reviewId,
      });
      throw new Error('Policy Restriction: Global Owner approval is strictly required for this server.');
    }

    if (policy === 'GLOBAL_AND_SERVER_OWNER') {
      if (!perms.isGlobalOwner && !perms.isServerOwner) {
        throw new Error(
          'Policy Restriction: Only the Global Owner and the Discord Server Owner can approve under Dual Owner Policy.',
        );
      }

      // If Global Owner IS NOT the Server Owner, require both distinct approvals
      const guildCfg = this.guildConfig.getGuildConfigOrThrow(ctx.guildId);
      const singlePersonHoldsBoth = isPermanentGlobalOwner(guildCfg.owner_id) && perms.isGlobalOwner;

      if (!singlePersonHoldsBoth) {
        if (!review.first_approver_id) {
          this.db.run(
            `UPDATE warning_reviews SET
              status = 'AWAITING_SECOND_APPROVAL',
              first_approver_id = ?,
              first_approver_name = ?,
              first_approved_at = ?,
              proposed_reason = COALESCE(?, proposed_reason),
              proposed_note = COALESCE(?, proposed_note),
              updated_at = ?
             WHERE guild_id = ? AND review_id = ?`,
            [
              ctx.userId,
              actorName,
              now,
              input?.proposedReason ?? null,
              input?.proposedNote ?? null,
              now,
              ctx.guildId,
              reviewId,
            ],
          );
          const updated = this.getReviewById(ctx.guildId, reviewId)!;
          return {
            stage: 'AWAITING_SECOND_APPROVAL',
            review: updated,
            message: perms.isGlobalOwner
              ? 'Global Owner approval recorded (1/2). Awaiting Discord Server Owner co-approval.'
              : 'Server Owner approval recorded (1/2). Awaiting Permanent Global Owner co-approval.',
          };
        }

        if (review.first_approver_id === ctx.userId) {
          throw new Error('Dual Policy: First approval already recorded by you; awaiting the other owner.');
        }

        const firstWasGlobal = isPermanentGlobalOwner(review.first_approver_id);
        if (firstWasGlobal && !perms.isServerOwner) {
          throw new Error('Dual Policy: Global Owner already approved; second approval must be by the Server Owner.');
        }
        if (!firstWasGlobal && !perms.isGlobalOwner) {
          throw new Error('Dual Policy: Server Owner already approved; second approval must be by the Global Owner.');
        }
      }
    } else if (policy === 'TWO_PERSON_APPROVAL') {
      if (!review.first_approver_id) {
        this.db.run(
          `UPDATE warning_reviews SET
            status = 'AWAITING_SECOND_APPROVAL',
            first_approver_id = ?,
            first_approver_name = ?,
            first_approved_at = ?,
            proposed_reason = COALESCE(?, proposed_reason),
            proposed_note = COALESCE(?, proposed_note),
            updated_at = ?
           WHERE guild_id = ? AND review_id = ?`,
          [
            ctx.userId,
            actorName,
            now,
            input?.proposedReason ?? null,
            input?.proposedNote ?? null,
            now,
            ctx.guildId,
            reviewId,
          ],
        );
        const updated = this.getReviewById(ctx.guildId, reviewId)!;
        return {
          stage: 'AWAITING_SECOND_APPROVAL',
          review: updated,
          message: 'First reviewer approval recorded (1/2). Awaiting a second distinct authorized reviewer.',
        };
      }

      if (review.first_approver_id === ctx.userId) {
        throw new Error('Two-Person Policy: A distinct second authorized reviewer must complete this approval.');
      }
    }

    let snapshot: ReviewSnapshotData | null = null;
    try {
      snapshot = JSON.parse(review.snapshot_json) as ReviewSnapshotData;
    } catch {
      snapshot = null;
    }

    const defaultReason = snapshot?.reasonForReview ?? 'Verified staff inactivity following full roster scan';
    const proposedReason = input?.proposedReason?.trim() || review.proposed_reason || defaultReason;
    const proposedNote = input?.proposedNote?.trim() || review.proposed_note || null;

    this.db.run(
      `UPDATE warning_reviews SET
        status = 'AWAITING_CONFIRMATION',
        pending_confirmer_id = ?,
        proposed_reason = ?,
        proposed_note = ?,
        updated_at = ?
       WHERE guild_id = ? AND review_id = ?`,
      [ctx.userId, proposedReason, proposedNote, now, ctx.guildId, reviewId],
    );

    const updated = this.getReviewById(ctx.guildId, reviewId)!;
    return {
      stage: 'AWAITING_FINAL_CONFIRMATION',
      review: updated,
      message: 'Pre-warning checks passed. Please review the proposed warning details and click FINAL CONFIRM.',
    };
  }

  /**
   * Step 2 of Approval: Executes Final Confirmation, re-verifies live case validity,
   * records actual approver ID & display name, issues the warning transactionally,
   * delivers staff DM, and logs audit history.
   */
  public async finalizeWarningConfirmation(
    ctx: ActorGuildContext,
    reviewId: string,
    actorDisplayName: string,
    overrideReason?: string,
    overrideNote?: string,
    nowIso = new Date().toISOString(),
  ): Promise<{ review: WarningReviewRecord; warning: WarningRecord | null; autoCancelledReason?: string }> {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'FINAL_CONFIRM_WARNING');

    if (review.status !== 'AWAITING_CONFIRMATION') {
      throw new Error(
        `Final confirmation requires initiating approval first (current review status: "${review.status}").`,
      );
    }
    if (review.pending_confirmer_id && review.pending_confirmer_id !== ctx.userId && !isPermanentGlobalOwner(ctx.userId)) {
      throw new Error('Only the reviewer who initiated confirmation (or Global Owner) can finalize this confirmation.');
    }

    // Re-verify live safety conditions one final time before issuing warning
    const validity = this.recheckCaseValidity(review, undefined, nowIso);
    if (!validity.valid) {
      if (validity.autoCancel) {
        const cancelled = await this.cancelReviewInternal(
          review,
          ctx.userId,
          validity.reason ?? 'Staff activity resumed prior to final confirmation',
          nowIso,
        );
        return {
          review: cancelled,
          warning: null,
          autoCancelledReason: validity.reason,
        };
      }
      throw new Error(`Final Confirmation Blocked: ${validity.reason}`);
    }

    const reason =
      overrideReason?.trim() ||
      review.proposed_reason ||
      'Confirmed staff inactivity following management review';
    const note = overrideNote?.trim() || review.proposed_note || null;

    const warning = await this.warnings.issueWarning({
      guildId: review.guild_id,
      staffUserId: review.staff_user_id,
      reason,
      managementNote: note,
      issuedById: ctx.userId,
      approverId: ctx.userId,
      approverDisplayName: actorDisplayName,
      reviewId: review.review_id,
      incidentId: review.incident_id,
      nowIso,
    });

    this.db.transaction(() => {
      this.db.run(
        `UPDATE warning_reviews SET
          status = 'APPROVED',
          final_actor_id = ?,
          final_actor_name = ?,
          final_note = ?,
          updated_at = ?
         WHERE guild_id = ? AND review_id = ?`,
        [ctx.userId, actorDisplayName, note, nowIso, review.guild_id, review.review_id],
      );

      if (review.incident_id) {
        this.db.run(
          `UPDATE inactivity_incidents SET
            status = 'APPROVED_WARNING',
            resolved_at = ?,
            updated_at = ?
           WHERE guild_id = ? AND incident_id = ?`,
          [nowIso, nowIso, review.guild_id, review.incident_id],
        );
      }
    });

    const finalized = this.getReviewById(review.guild_id, review.review_id)!;
    this.audit.log({
      guildId: review.guild_id,
      actorUserId: ctx.userId,
      actorTag: actorDisplayName,
      actionCategory: 'REVIEW',
      actionType: 'REVIEW_APPROVED_AND_WARNING_ISSUED',
      targetType: 'REVIEW',
      targetId: review.review_id,
      after: { reviewId: review.review_id, warningId: warning.warning_id },
    });

    return { review: finalized, warning };
  }

  public abortConfirmation(ctx: ActorGuildContext, reviewId: string): WarningReviewRecord {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'ABORT_WARNING_CONFIRMATION');
    if (review.status !== 'AWAITING_CONFIRMATION') {
      return review;
    }

    const revertStatus = review.first_approver_id ? 'AWAITING_SECOND_APPROVAL' : 'PENDING';
    this.db.run(
      `UPDATE warning_reviews SET status = ?, pending_confirmer_id = NULL, updated_at = ?
       WHERE guild_id = ? AND review_id = ?`,
      [revertStatus, new Date().toISOString(), ctx.guildId, reviewId],
    );
    return this.getReviewById(ctx.guildId, reviewId)!;
  }

  public rejectReview(
    ctx: ActorGuildContext,
    reviewId: string,
    actorDisplayName: string,
    note?: string,
    nowIso = new Date().toISOString(),
  ): WarningReviewRecord {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    const perms = this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'REJECT_WARNING_REVIEW');

    if (review.required_policy === 'GLOBAL_OWNER_REQUIRED' && !perms.isGlobalOwner) {
      throw new Error('Policy Restriction: Only the Global Owner can decide reviews under Global Owner Policy.');
    }
    if (!this.isOpenReviewStatus(review.status)) {
      throw new Error(`Review ${reviewId} is already finalized (${review.status}).`);
    }

    this.db.transaction(() => {
      this.db.run(
        `UPDATE warning_reviews SET
          status = 'REJECTED',
          final_actor_id = ?,
          final_actor_name = ?,
          final_note = ?,
          updated_at = ?
         WHERE guild_id = ? AND review_id = ?`,
        [ctx.userId, actorDisplayName, note?.trim() || 'Rejected by reviewer', nowIso, ctx.guildId, reviewId],
      );

      if (review.incident_id) {
        this.db.run(
          `UPDATE inactivity_incidents SET status = 'REJECTED', resolved_at = ?, updated_at = ?
           WHERE guild_id = ? AND incident_id = ?`,
          [nowIso, nowIso, ctx.guildId, review.incident_id],
        );
      }
    });

    const updated = this.getReviewById(ctx.guildId, reviewId)!;
    this.audit.log({
      guildId: ctx.guildId,
      actorUserId: ctx.userId,
      actorTag: actorDisplayName,
      actionCategory: 'REVIEW',
      actionType: 'REVIEW_REJECTED',
      targetType: 'REVIEW',
      targetId: reviewId,
      after: updated,
    });
    return updated;
  }

  public deferReviewLater(
    ctx: ActorGuildContext,
    reviewId: string,
    deferHours = 12,
    note?: string,
    nowIso = new Date().toISOString(),
  ): WarningReviewRecord {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'DEFER_WARNING_REVIEW');

    if (!this.isOpenReviewStatus(review.status)) {
      throw new Error(`Review ${reviewId} is already finalized (${review.status}).`);
    }

    const deferredUntil = new Date(Date.parse(nowIso) + Math.max(1, deferHours) * 3_600_000).toISOString();
    this.db.run(
      `UPDATE warning_reviews SET
        status = 'DEFERRED',
        deferred_until = ?,
        final_note = ?,
        updated_at = ?
       WHERE guild_id = ? AND review_id = ?`,
      [deferredUntil, note?.trim() || `Deferred for ${deferHours}h`, nowIso, ctx.guildId, reviewId],
    );

    const updated = this.getReviewById(ctx.guildId, reviewId)!;
    this.audit.log({
      guildId: ctx.guildId,
      actorUserId: ctx.userId,
      actionCategory: 'REVIEW',
      actionType: 'REVIEW_DEFERRED_LATER',
      targetType: 'REVIEW',
      targetId: reviewId,
      after: updated,
    });
    return updated;
  }

  public markReviewExcused(
    ctx: ActorGuildContext,
    reviewId: string,
    actorDisplayName: string,
    excuseReason?: string,
    nowIso = new Date().toISOString(),
  ): WarningReviewRecord {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'EXCUSE_WARNING_REVIEW');

    if (!this.isOpenReviewStatus(review.status)) {
      throw new Error(`Review ${reviewId} is already finalized (${review.status}).`);
    }

    this.db.transaction(() => {
      this.db.run(
        `UPDATE warning_reviews SET
          status = 'EXCUSED',
          final_actor_id = ?,
          final_actor_name = ?,
          final_note = ?,
          updated_at = ?
         WHERE guild_id = ? AND review_id = ?`,
        [ctx.userId, actorDisplayName, excuseReason?.trim() || 'Marked excused by management', nowIso, ctx.guildId, reviewId],
      );

      if (review.incident_id) {
        this.db.run(
          `UPDATE inactivity_incidents SET status = 'EXCUSED', resolved_at = ?, updated_at = ?
           WHERE guild_id = ? AND incident_id = ?`,
          [nowIso, nowIso, ctx.guildId, review.incident_id],
        );
      }
    });

    const updated = this.getReviewById(ctx.guildId, reviewId)!;
    this.audit.log({
      guildId: ctx.guildId,
      actorUserId: ctx.userId,
      actorTag: actorDisplayName,
      actionCategory: 'REVIEW',
      actionType: 'REVIEW_MARKED_EXCUSED',
      targetType: 'REVIEW',
      targetId: reviewId,
      after: updated,
    });
    return updated;
  }

  public async cancelReviewByCommand(
    ctx: ActorGuildContext,
    reviewId: string,
    reason: string,
    nowIso = new Date().toISOString(),
  ): Promise<WarningReviewRecord> {
    const review = this.getReviewAndVerifyGuildIsolation(ctx.guildId, reviewId);
    this.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'CANCEL_WARNING_REVIEW');
    if (!this.isOpenReviewStatus(review.status)) {
      throw new Error(`Review ${reviewId} is already finalized (${review.status}).`);
    }
    return this.cancelReviewInternal(review, ctx.userId, reason.trim() || 'Cancelled by management', nowIso);
  }

  /**
   * Automatically cancels pending inactivity reviews & incidents when qualifying work resumes,
   * and notifies the authorized reviewers.
   */
  public async cancelPendingReviewsOnWorkResumed(
    guildId: string,
    staffUserId: string,
    reason: string,
    nowIso = new Date().toISOString(),
  ): Promise<number> {
    const openReviews = this.db.all<WarningReviewRecord>(
      `SELECT * FROM warning_reviews
       WHERE guild_id = ? AND staff_user_id = ?
         AND status IN ('PENDING', 'DEFERRED', 'AWAITING_SECOND_APPROVAL', 'AWAITING_CONFIRMATION')`,
      [guildId, staffUserId],
    );

    const openIncidents = this.db.all<InactivityIncidentRecord>(
      `SELECT * FROM inactivity_incidents
       WHERE guild_id = ? AND staff_user_id = ?
         AND status IN ('OPEN', 'AT_RISK', 'PENDING_REVIEW', 'ESCALATED')`,
      [guildId, staffUserId],
    );

    if (openReviews.length === 0 && openIncidents.length === 0) {
      return 0;
    }

    this.db.transaction(() => {
      for (const rev of openReviews) {
        this.db.run(
          `UPDATE warning_reviews SET
            status = 'CANCELLED',
            final_actor_id = 'SYSTEM_ACTIVITY_RESUMED',
            final_actor_name = 'Automated Activity Resumption Guard',
            final_note = ?,
            updated_at = ?
           WHERE guild_id = ? AND review_id = ?`,
          [reason, nowIso, guildId, rev.review_id],
        );
      }

      for (const inc of openIncidents) {
        this.db.run(
          `UPDATE inactivity_incidents SET
            status = 'AUTO_CANCELLED_RESUMED',
            cancellation_reason = ?,
            resolved_at = ?,
            updated_at = ?
           WHERE guild_id = ? AND incident_id = ?`,
          [reason, nowIso, nowIso, guildId, inc.incident_id],
        );
      }
    });

    if (openReviews.length > 0 && this.features.isEnabled(guildId, 'approval_notifications')) {
      const guildCfg = this.guildConfig.getGuildConfig(guildId);
      const recipients = this.permissions.resolveDeduplicatedReviewRecipients(guildId);
      const reviewIdsList = openReviews.map((r) => `\`${r.review_id}\``).join(', ');

      const cancelEmbed = createBrandEmbed({
        title: `${emojis.get('active')} Pending Inactivity Review Cancelled — Work Resumed`,
        tone: 'success',
        subtitle: guildCfg?.guild_name ?? guildId,
        description:
          `Staff member <@${staffUserId}> (\`${staffUserId}\`) performed qualifying staff work.\n` +
          `Pending review(s) ${reviewIdsList} have been **automatically cancelled** to prevent obsolete warnings.`,
      }).addFields({ name: 'Cancellation Trigger', value: reason, inline: false });

      await this.notifications.dispatchDeduplicatedGroup({
        guildId,
        recipientUserIds: recipients,
        notificationType: 'REVIEW_CANCELLED_WORK_RESUMED',
        baseDedupKey: `rev-cancel-resumed:${openReviews[0].review_id}`,
        referenceId: openReviews[0].review_id,
        title: 'Inactivity Review Auto-Cancelled (Work Resumed)',
        summary: `Staff ${staffUserId} resumed work; cancelled ${openReviews.length} pending review(s).`,
        payload: { embeds: [cancelEmbed] },
      });
    }

    return openReviews.length;
  }

  private async cancelReviewInternal(
    review: WarningReviewRecord,
    actorId: string,
    reason: string,
    nowIso: string,
  ): Promise<WarningReviewRecord> {
    this.db.transaction(() => {
      this.db.run(
        `UPDATE warning_reviews SET
          status = 'CANCELLED',
          final_actor_id = ?,
          final_note = ?,
          updated_at = ?
         WHERE guild_id = ? AND review_id = ?`,
        [actorId, reason, nowIso, review.guild_id, review.review_id],
      );

      if (review.incident_id) {
        this.db.run(
          `UPDATE inactivity_incidents SET
            status = 'AUTO_CANCELLED_RESUMED',
            cancellation_reason = ?,
            resolved_at = ?,
            updated_at = ?
           WHERE guild_id = ? AND incident_id = ?`,
          [reason, nowIso, nowIso, review.guild_id, review.incident_id],
        );
      }
    });

    const cancelled = this.getReviewById(review.guild_id, review.review_id)!;
    this.audit.log({
      guildId: review.guild_id,
      actorUserId: actorId,
      actionCategory: 'REVIEW',
      actionType: 'REVIEW_CANCELLED',
      targetType: 'REVIEW',
      targetId: review.review_id,
      after: cancelled,
    });
    return cancelled;
  }

  private isOpenReviewStatus(status: WarningReviewRecord['status']): boolean {
    return (
      status === 'PENDING' ||
      status === 'DEFERRED' ||
      status === 'AWAITING_SECOND_APPROVAL' ||
      status === 'AWAITING_CONFIRMATION'
    );
  }

  public getReviewById(guildId: string, reviewId: string): WarningReviewRecord | undefined {
    return this.db.get<WarningReviewRecord>(
      'SELECT * FROM warning_reviews WHERE guild_id = ? AND review_id = ?',
      [guildId, reviewId],
    );
  }

  /**
   * Looks up a review by ID (e.g., from a DM button click where `interaction.guildId` is null)
   * so persistent DM buttons resolve their exact owning guild safely!
   */
  public findReviewGloballyById(reviewId: string): WarningReviewRecord | undefined {
    return this.db.get<WarningReviewRecord>('SELECT * FROM warning_reviews WHERE review_id = ?', [reviewId]);
  }

  private getReviewAndVerifyGuildIsolation(expectedGuildId: string, reviewId: string): WarningReviewRecord {
    const found = this.findReviewGloballyById(reviewId);
    if (!found || found.guild_id !== expectedGuildId) {
      throw new Error(`Review ${reviewId} does not exist in server ${expectedGuildId}.`);
    }
    return found;
  }

  public listGuildReviews(
    guildId: string,
    options?: { pendingOnly?: boolean; limit?: number; offset?: number },
  ): WarningReviewRecord[] {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);

    if (options?.pendingOnly) {
      return this.db.all<WarningReviewRecord>(
        `SELECT * FROM warning_reviews
         WHERE guild_id = ?
           AND status IN ('PENDING', 'DEFERRED', 'AWAITING_SECOND_APPROVAL', 'AWAITING_CONFIRMATION')
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [guildId, limit, offset],
      );
    }

    return this.db.all<WarningReviewRecord>(
      `SELECT * FROM warning_reviews
       WHERE guild_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [guildId, limit, offset],
    );
  }

  public listGlobalReviews(actorUserId: string, pendingOnly = false, limit = 25): WarningReviewRecord[] {
    if (!isPermanentGlobalOwner(actorUserId)) {
      throw new Error('Forbidden: Global review listing is restricted to the Permanent Global Owner.');
    }
    if (pendingOnly) {
      return this.db.all<WarningReviewRecord>(
        `SELECT * FROM warning_reviews
         WHERE status IN ('PENDING', 'DEFERRED', 'AWAITING_SECOND_APPROVAL', 'AWAITING_CONFIRMATION')
         ORDER BY created_at DESC LIMIT ?`,
        [limit],
      );
    }
    return this.db.all<WarningReviewRecord>(
      'SELECT * FROM warning_reviews ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
  }
}
