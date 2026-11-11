import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { IRelationalDatabase } from '../database/connection';
import { BRANDING, GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { emojis } from '../config/emojis';
import { WarningAppealRecord, WarningRecord } from '../types/domain';
import { createBrandEmbed } from '../utils/embeds';
import { generateEntityId } from '../utils/ids';
import { AuditService } from './AuditService';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { NotificationService } from './NotificationService';
import { PermissionService } from './PermissionService';

export function formatWarningLevelLabel(level: number): string {
  if (level >= 3) return 'Warning 3/3 — Final warning / Management review';
  if (level === 2) return 'Warning 2/3';
  return 'Warning 1/3';
}

export class WarningService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly permissions: PermissionService;
  private readonly notifications: NotificationService;
  private readonly audit: AuditService;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    permissions: PermissionService,
    notifications: NotificationService,
    audit: AuditService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.permissions = permissions;
    this.notifications = notifications;
    this.audit = audit;
  }

  /**
   * Expires warnings whose `expires_at <= nowIso` and refreshes staff profile active warning counts.
   */
  public expireElapsedWarnings(guildId: string, nowIso = new Date().toISOString()): number {
    const affectedStaff = this.db.all<{ staff_user_id: string }>(
      `SELECT DISTINCT staff_user_id FROM warnings
       WHERE guild_id = ? AND status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?`,
      [guildId, nowIso],
    );

    if (affectedStaff.length === 0) return 0;

    let changed = 0;
    this.db.transaction(() => {
      const res = this.db.run(
        `UPDATE warnings SET status = 'EXPIRED'
         WHERE guild_id = ? AND status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?`,
        [guildId, nowIso],
      );
      changed = res.changes;
      for (const s of affectedStaff) {
        this.recomputeStaffWarningCounts(guildId, s.staff_user_id);
      }
    });

    return changed;
  }

  public computeNextWarningLevel(guildId: string, staffUserId: string, nowIso = new Date().toISOString()): 1 | 2 | 3 {
    this.expireElapsedWarnings(guildId, nowIso);
    const activeRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM warnings
       WHERE guild_id = ? AND staff_user_id = ? AND status = 'ACTIVE'`,
      [guildId, staffUserId],
    );
    const next = Math.min(3, (activeRow?.cnt ?? 0) + 1);
    return next as 1 | 2 | 3;
  }

  /**
   * Issues an official warning transactionally, attempts DM delivery to the warned staff member,
   * records DM success/failure, notifies management on failure or Level 3/3 escalation,
   * and NEVER performs any automated kick, ban, demotion, or role removal.
   */
  public async issueWarning(input: {
    guildId: string;
    staffUserId: string;
    reason: string;
    managementNote?: string | null;
    issuedById: string;
    approverId: string;
    approverDisplayName: string;
    explicitLevel?: 1 | 2 | 3;
    reviewId?: string | null;
    incidentId?: string | null;
    nowIso?: string;
  }): Promise<WarningRecord> {
    const guildCfg = this.guildConfig.getGuildConfigOrThrow(input.guildId);
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 3) {
      throw new Error('Warning reason must be at least 3 characters.');
    }

    const now = input.nowIso ?? new Date().toISOString();
    const level = input.explicitLevel ?? this.computeNextWarningLevel(input.guildId, input.staffUserId, now);

    // Prevent false attribution to Tanveer if someone else approved it!
    let safeApproverDisplay = input.approverDisplayName.trim() || `User ${input.approverId}`;
    if (!isPermanentGlobalOwner(input.approverId) && /tanveer/i.test(safeApproverDisplay)) {
      safeApproverDisplay = `Reviewer (${input.approverId})`;
    }

    const expiresAt =
      guildCfg.warning_expiry_days > 0
        ? new Date(Date.parse(now) + guildCfg.warning_expiry_days * 86_400_000).toISOString()
        : null;

    const warningId = generateEntityId('WRN');
    const requiresManagementReview = level >= 3 ? 1 : 0;

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO warnings (
          warning_id, guild_id, staff_user_id, review_id, incident_id,
          warning_level, status, reason, management_note,
          issued_by_id, approver_id, approver_display_name, approved_at,
          dm_delivered, dm_error, fallback_notified, expires_at, requires_management_review
        ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?, ?, ?, 0, NULL, 0, ?, ?)`,
        [
          warningId,
          input.guildId,
          input.staffUserId,
          input.reviewId ?? null,
          input.incidentId ?? null,
          level,
          trimmedReason,
          input.managementNote?.trim() || null,
          input.issuedById,
          input.approverId,
          safeApproverDisplay,
          now,
          expiresAt,
          requiresManagementReview,
        ],
      );

      this.recomputeStaffWarningCounts(input.guildId, input.staffUserId);
    });

    // Attempt official DM delivery if warning_delivery feature is enabled
    let dmDelivered = false;
    let dmError: string | null = null;
    let fallbackNotified = false;

    const dmEmbed = createBrandEmbed({
      title: `${emojis.get('warning')} Official Staff Activity Warning`,
      tone: level >= 3 ? 'danger' : 'warning',
      subtitle: 'Official Warning Delivery System',
      description:
        `This official notice is delivered by **${BRANDING.projectName}** on behalf of **${guildCfg.guild_name}** management.\n` +
        (level >= 3
          ? `\n${emojis.get('error')} **Notice:** You have reached **Warning 3/3**. Your case has been flagged for **human management review**. No automated role removal or termination has been executed.`
          : ''),
    }).addFields(
      { name: 'Warning Level', value: formatWarningLevelLabel(level), inline: true },
      { name: 'Warning ID', value: `\`${warningId}\``, inline: true },
      { name: 'Server Name', value: guildCfg.guild_name, inline: true },
      { name: 'Reason', value: trimmedReason, inline: false },
      ...(input.managementNote?.trim()
        ? [{ name: 'Management Note', value: input.managementNote.trim(), inline: false }]
        : []),
      { name: 'Delivery System (Issued By)', value: `${BRANDING.projectName} Delivery Engine`, inline: true },
      {
        name: 'Approved By',
        value: `${safeApproverDisplay} (\`${input.approverId}\`)`,
        inline: true,
      },
      { name: 'Approval Date', value: now, inline: true },
      {
        name: 'Appeal Instructions',
        value: `You may submit a formal appeal inside **${guildCfg.guild_name}** using \`/warning appeal warning_id:${warningId} reason:<your explanation>\` or by clicking **Submit Appeal** below.`,
        inline: false,
      },
    );

    const appealRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`tsm:wrn:appeal:${warningId}`)
        .setLabel('Submit Appeal')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.forComponent('tickets')),
    );

    const deliveryAllowed = this.features.isEnabled(input.guildId, 'warning_delivery');
    const adapter = this.notifications.getDeliveryAdapter();

    if (deliveryAllowed && adapter) {
      const dmRes = await adapter.sendDirectMessage(input.staffUserId, {
        embeds: [dmEmbed],
        components: [appealRow],
      });
      if (dmRes.delivered) {
        dmDelivered = true;
      } else {
        dmError = dmRes.error ?? 'Staff member DMs disabled or unreachable';
      }
    } else if (!deliveryAllowed) {
      dmError = 'Warning DM delivery feature is currently disabled in settings';
    } else {
      dmError = 'No live Discord gateway adapter connected';
    }

    // If DM failed OR Warning 3/3 management review triggered, notify authorized management
    if (!dmDelivered || requiresManagementReview === 1) {
      const recipients = this.permissions.resolveDeduplicatedReviewRecipients(input.guildId);
      const alertTitle = !dmDelivered
        ? `${emojis.get('error')} Warning DM Delivery Failed — Action Recorded (\`${warningId}\`)`
        : `${emojis.get('warning')} Warning 3/3 Reached — Management Review Triggered (\`${warningId}\`)`;

      const mgmtEmbed = createBrandEmbed({
        title: alertTitle,
        tone: !dmDelivered ? 'danger' : 'warning',
        subtitle: guildCfg.guild_name,
        description: !dmDelivered
          ? `Warning \`${warningId}\` (**${formatWarningLevelLabel(level)}**) for <@${input.staffUserId}> (\`${input.staffUserId}\`) has been saved in the database, but DM delivery failed (\`${dmError}\`). Please notify the staff member via an appropriate server channel.`
          : `Staff member <@${input.staffUserId}> (\`${input.staffUserId}\`) has received **Warning 3/3**. Per safety policy, no automatic demotion/kick/ban was taken — human management review is now requested.`,
      }).addFields(
        { name: 'Warning ID', value: `\`${warningId}\``, inline: true },
        { name: 'Approved By', value: `${safeApproverDisplay} (\`${input.approverId}\`)`, inline: true },
        { name: 'DM Status', value: dmDelivered ? 'Delivered' : `Failed (${dmError})`, inline: true },
      );

      await this.notifications.dispatchDeduplicatedGroup({
        guildId: input.guildId,
        recipientUserIds: recipients,
        notificationType: !dmDelivered ? 'WARNING_DM_FAILED' : 'WARNING_LEVEL_3_REVIEW',
        baseDedupKey: `warn-mgmt:${warningId}`,
        referenceId: warningId,
        title: alertTitle,
        summary: `Warning ${warningId} (${formatWarningLevelLabel(level)}) for staff ${input.staffUserId}`,
        payload: { embeds: [mgmtEmbed] },
      });

      fallbackNotified = true;
    }

    this.db.run(
      `UPDATE warnings SET dm_delivered = ?, dm_error = ?, fallback_notified = ?
       WHERE guild_id = ? AND warning_id = ?`,
      [dmDelivered ? 1 : 0, dmError, fallbackNotified ? 1 : 0, input.guildId, warningId],
    );

    const saved = this.getWarningById(input.guildId, warningId)!;
    this.audit.log({
      guildId: input.guildId,
      actorUserId: input.approverId,
      actorTag: safeApproverDisplay,
      actionCategory: 'WARNING',
      actionType: 'WARNING_ISSUED',
      targetType: 'WARNING',
      targetId: warningId,
      after: saved,
    });

    return saved;
  }

  public removeWarning(input: {
    guildId: string;
    warningId: string;
    actorUserId: string;
    removalReason: string;
    nowIso?: string;
  }): WarningRecord {
    const trimmedReason = input.removalReason.trim();
    if (trimmedReason.length < 3) {
      throw new Error('A clear removal reason (minimum 3 characters) is mandatory when removing a warning.');
    }

    const existing = this.getWarningById(input.guildId, input.warningId);
    if (!existing) {
      throw new Error(`Warning ${input.warningId} not found in this server.`);
    }
    if (existing.status === 'REMOVED') {
      throw new Error(`Warning ${input.warningId} has already been removed.`);
    }

    const now = input.nowIso ?? new Date().toISOString();

    this.db.transaction(() => {
      this.db.run(
        `UPDATE warnings SET
          status = 'REMOVED',
          removed_by_id = ?,
          removed_reason = ?,
          removed_at = ?
        WHERE guild_id = ? AND warning_id = ?`,
        [input.actorUserId, trimmedReason, now, input.guildId, input.warningId],
      );
      this.recomputeStaffWarningCounts(input.guildId, existing.staff_user_id);
    });

    const updated = this.getWarningById(input.guildId, input.warningId)!;
    this.audit.log({
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      actionCategory: 'WARNING',
      actionType: 'WARNING_REMOVED',
      targetType: 'WARNING',
      targetId: input.warningId,
      before: existing,
      after: updated,
      metadata: { removalReason: trimmedReason },
    });

    return updated;
  }

  public submitAppeal(input: {
    guildId: string;
    warningId: string;
    staffUserId: string;
    appealReason: string;
    nowIso?: string;
  }): WarningAppealRecord {
    const warning = this.getWarningById(input.guildId, input.warningId);
    if (!warning) {
      throw new Error(`Warning ${input.warningId} not found in this server.`);
    }
    if (warning.staff_user_id !== input.staffUserId && !isPermanentGlobalOwner(input.staffUserId)) {
      throw new Error('Only the warned staff member can submit an appeal for this warning.');
    }
    if (warning.status !== 'ACTIVE') {
      throw new Error(`Cannot appeal a warning with status "${warning.status}".`);
    }

    const existingPending = this.db.get<WarningAppealRecord>(
      `SELECT * FROM warning_appeals
       WHERE guild_id = ? AND warning_id = ? AND status = 'PENDING'`,
      [input.guildId, input.warningId],
    );
    if (existingPending) {
      throw new Error(`An appeal (\`${existingPending.appeal_id}\`) is already pending for warning ${input.warningId}.`);
    }

    const reason = input.appealReason.trim();
    if (reason.length < 5) {
      throw new Error('Appeal explanation must be at least 5 characters.');
    }

    const appealId = generateEntityId('APL');
    const now = input.nowIso ?? new Date().toISOString();

    this.db.run(
      `INSERT INTO warning_appeals (
        appeal_id, warning_id, guild_id, staff_user_id, appeal_reason, status, submitted_at
      ) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)`,
      [appealId, input.warningId, input.guildId, warning.staff_user_id, reason, now],
    );

    const saved = this.getAppealById(input.guildId, appealId)!;
    this.audit.log({
      guildId: input.guildId,
      actorUserId: input.staffUserId,
      actionCategory: 'WARNING',
      actionType: 'WARNING_APPEAL_SUBMITTED',
      targetType: 'APPEAL',
      targetId: appealId,
      after: saved,
    });

    return saved;
  }

  public decideAppeal(input: {
    guildId: string;
    appealId: string;
    actorUserId: string;
    actorDisplayName: string;
    decision: 'APPROVED' | 'REJECTED';
    decisionNote: string;
    nowIso?: string;
  }): WarningAppealRecord {
    const appeal = this.getAppealById(input.guildId, input.appealId);
    if (!appeal) {
      throw new Error(`Appeal ${input.appealId} not found in this server.`);
    }
    if (appeal.status !== 'PENDING') {
      throw new Error(`Appeal ${input.appealId} has already been decided (${appeal.status}).`);
    }

    const now = input.nowIso ?? new Date().toISOString();
    const note = input.decisionNote.trim() || `Appeal ${input.decision.toLowerCase()} by management`;

    this.db.transaction(() => {
      this.db.run(
        `UPDATE warning_appeals SET
          status = ?,
          decided_by_id = ?,
          decided_by_name = ?,
          decision_note = ?,
          decided_at = ?
        WHERE guild_id = ? AND appeal_id = ?`,
        [input.decision, input.actorUserId, input.actorDisplayName, note, now, input.guildId, input.appealId],
      );

      if (input.decision === 'APPROVED') {
        this.db.run(
          `UPDATE warnings SET
            status = 'APPEALED_OVERTURNED',
            removed_by_id = ?,
            removed_reason = ?,
            removed_at = ?
          WHERE guild_id = ? AND warning_id = ?`,
          [input.actorUserId, `Appeal ${input.appealId} approved: ${note}`, now, input.guildId, appeal.warning_id],
        );
        this.recomputeStaffWarningCounts(input.guildId, appeal.staff_user_id);
      }
    });

    const updated = this.getAppealById(input.guildId, input.appealId)!;
    this.audit.log({
      guildId: input.guildId,
      actorUserId: input.actorUserId,
      actorTag: input.actorDisplayName,
      actionCategory: 'WARNING',
      actionType: input.decision === 'APPROVED' ? 'WARNING_APPEAL_APPROVED' : 'WARNING_APPEAL_REJECTED',
      targetType: 'APPEAL',
      targetId: input.appealId,
      before: appeal,
      after: updated,
    });

    return updated;
  }

  public recomputeStaffWarningCounts(guildId: string, staffUserId: string): void {
    const counts = this.db.get<{ active_cnt: number; total_cnt: number }>(
      `SELECT
        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_cnt,
        COUNT(*) AS total_cnt
       FROM warnings
       WHERE guild_id = ? AND staff_user_id = ?`,
      [guildId, staffUserId],
    );

    this.db.run(
      `UPDATE staff_profiles SET
        active_warnings_count = ?,
        total_warnings_count = ?,
        updated_at = ?
       WHERE guild_id = ? AND user_id = ?`,
      [counts?.active_cnt ?? 0, counts?.total_cnt ?? 0, new Date().toISOString(), guildId, staffUserId],
    );
  }

  public getWarningById(guildId: string, warningId: string): WarningRecord | undefined {
    return this.db.get<WarningRecord>(
      'SELECT * FROM warnings WHERE guild_id = ? AND warning_id = ?',
      [guildId, warningId],
    );
  }

  public findWarningGlobally(warningId: string): WarningRecord | undefined {
    return this.db.get<WarningRecord>('SELECT * FROM warnings WHERE warning_id = ?', [warningId]);
  }

  public getAppealById(guildId: string, appealId: string): WarningAppealRecord | undefined {
    return this.db.get<WarningAppealRecord>(
      'SELECT * FROM warning_appeals WHERE guild_id = ? AND appeal_id = ?',
      [guildId, appealId],
    );
  }

  public listWarnings(
    guildId: string,
    options?: { staffUserId?: string; onlyActive?: boolean; limit?: number },
  ): WarningRecord[] {
    this.expireElapsedWarnings(guildId);
    const clauses = ['guild_id = ?'];
    const params: unknown[] = [guildId];
    if (options?.staffUserId) {
      clauses.push('staff_user_id = ?');
      params.push(options.staffUserId);
    }
    if (options?.onlyActive) {
      clauses.push("status = 'ACTIVE'");
    }
    params.push(options?.limit ?? 25);
    return this.db.all<WarningRecord>(
      `SELECT * FROM warnings WHERE ${clauses.join(' AND ')} ORDER BY approved_at DESC LIMIT ?`,
      params,
    );
  }

  public listAppeals(guildId: string, status?: 'PENDING' | 'APPROVED' | 'REJECTED', limit = 25): WarningAppealRecord[] {
    if (status) {
      return this.db.all<WarningAppealRecord>(
        'SELECT * FROM warning_appeals WHERE guild_id = ? AND status = ? ORDER BY submitted_at DESC LIMIT ?',
        [guildId, status, limit],
      );
    }
    return this.db.all<WarningAppealRecord>(
      'SELECT * FROM warning_appeals WHERE guild_id = ? ORDER BY submitted_at DESC LIMIT ?',
      [guildId, limit],
    );
  }

  public getGlobalWarningCount(): number {
    const row = this.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM warnings');
    return row?.cnt ?? 0;
  }

  public getGlobalAppeals(actorUserId: string, limit = 25): WarningAppealRecord[] {
    if (!isPermanentGlobalOwner(actorUserId)) {
      throw new Error('Forbidden: Global appeal inspection is restricted to the Global Owner.');
    }
    return this.db.all<WarningAppealRecord>(
      'SELECT * FROM warning_appeals ORDER BY submitted_at DESC LIMIT ?',
      [limit],
    );
  }
}
