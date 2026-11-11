import { IRelationalDatabase } from '../database/connection';
import { ApprovedLeaveRecord } from '../types/domain';
import { generateEntityId } from '../utils/ids';
import { AuditService } from './AuditService';
import { GuildConfigService } from './GuildConfigService';

export class LeaveService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly audit: AuditService;

  constructor(db: IRelationalDatabase, guildConfig: GuildConfigService, audit: AuditService) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.audit = audit;
  }

  public submitLeaveRequest(input: {
    guildId: string;
    staffUserId: string;
    requestedById: string;
    reason: string;
    startAt: string;
    endAt: string;
    autoApproveById?: string | null;
    nowIso?: string;
  }): ApprovedLeaveRecord {
    this.guildConfig.getGuildConfigOrThrow(input.guildId);
    const trimmedReason = input.reason.trim();
    if (trimmedReason.length < 3) {
      throw new Error('Leave reason must be at least 3 characters.');
    }

    const startMs = Date.parse(input.startAt);
    const endMs = Date.parse(input.endAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
      throw new Error('Invalid ISO start or end date supplied for leave.');
    }
    if (endMs <= startMs) {
      throw new Error('Leave end date must be strictly after start date.');
    }

    const now = input.nowIso ?? new Date().toISOString();
    const nowMs = Date.parse(now);
    const leaveId = generateEntityId('LVE');

    let initialStatus: ApprovedLeaveRecord['status'] = 'PENDING';
    if (input.autoApproveById) {
      initialStatus = startMs <= nowMs && nowMs <= endMs ? 'ACTIVE' : 'APPROVED';
    }

    this.db.run(
      `INSERT INTO approved_leave (
        leave_id, guild_id, staff_user_id, status, reason,
        requested_by_id, approved_by_id, start_at, end_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leaveId,
        input.guildId,
        input.staffUserId,
        initialStatus,
        trimmedReason,
        input.requestedById,
        input.autoApproveById ?? null,
        new Date(startMs).toISOString(),
        new Date(endMs).toISOString(),
        now,
        now,
      ],
    );

    if (initialStatus === 'ACTIVE') {
      this.db.run(
        `UPDATE staff_profiles SET monitoring_status = 'ON_LEAVE', updated_at = ?
         WHERE guild_id = ? AND user_id = ?`,
        [now, input.guildId, input.staffUserId],
      );
    }

    const record = this.getLeaveById(input.guildId, leaveId)!;
    this.audit.log({
      guildId: input.guildId,
      actorUserId: input.autoApproveById ?? input.requestedById,
      actionCategory: 'LEAVE',
      actionType: input.autoApproveById ? 'LEAVE_CREATED_AND_APPROVED' : 'LEAVE_REQUEST_SUBMITTED',
      targetType: 'LEAVE',
      targetId: leaveId,
      after: record,
    });
    return record;
  }

  public approveLeave(
    guildId: string,
    leaveId: string,
    approverId: string,
    decisionNote?: string,
    nowIso = new Date().toISOString(),
  ): ApprovedLeaveRecord {
    const existing = this.getLeaveById(guildId, leaveId);
    if (!existing) throw new Error(`Leave request ${leaveId} not found.`);
    if (existing.status !== 'PENDING' && existing.status !== 'APPROVED') {
      throw new Error(`Leave request ${leaveId} cannot be approved from status "${existing.status}".`);
    }

    const nowMs = Date.parse(nowIso);
    const startMs = Date.parse(existing.start_at);
    const endMs = Date.parse(existing.end_at);
    const nextStatus: ApprovedLeaveRecord['status'] =
      nowMs > endMs ? 'COMPLETED' : startMs <= nowMs ? 'ACTIVE' : 'APPROVED';

    this.db.transaction(() => {
      this.db.run(
        `UPDATE approved_leave SET
          status = ?,
          approved_by_id = ?,
          decision_note = ?,
          updated_at = ?
        WHERE guild_id = ? AND leave_id = ?`,
        [nextStatus, approverId, decisionNote ?? null, nowIso, guildId, leaveId],
      );

      if (nextStatus === 'ACTIVE') {
        this.db.run(
          `UPDATE staff_profiles SET monitoring_status = 'ON_LEAVE', updated_at = ?
           WHERE guild_id = ? AND user_id = ?`,
          [nowIso, guildId, existing.staff_user_id],
        );
      }
    });

    const updated = this.getLeaveById(guildId, leaveId)!;
    this.audit.log({
      guildId,
      actorUserId: approverId,
      actionCategory: 'LEAVE',
      actionType: 'LEAVE_APPROVED',
      targetType: 'LEAVE',
      targetId: leaveId,
      before: existing,
      after: updated,
    });
    return updated;
  }

  public rejectLeave(
    guildId: string,
    leaveId: string,
    actorUserId: string,
    decisionNote: string,
    nowIso = new Date().toISOString(),
  ): ApprovedLeaveRecord {
    const existing = this.getLeaveById(guildId, leaveId);
    if (!existing) throw new Error(`Leave request ${leaveId} not found.`);
    if (existing.status !== 'PENDING') {
      throw new Error(`Only pending leave requests can be rejected (current: ${existing.status}).`);
    }

    this.db.run(
      `UPDATE approved_leave SET
        status = 'REJECTED',
        approved_by_id = ?,
        decision_note = ?,
        updated_at = ?
      WHERE guild_id = ? AND leave_id = ?`,
      [actorUserId, decisionNote.trim() || 'Rejected by management', nowIso, guildId, leaveId],
    );

    const updated = this.getLeaveById(guildId, leaveId)!;
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'LEAVE',
      actionType: 'LEAVE_REJECTED',
      targetType: 'LEAVE',
      targetId: leaveId,
      before: existing,
      after: updated,
    });
    return updated;
  }

  public cancelLeave(
    guildId: string,
    leaveId: string,
    actorUserId: string,
    reason: string,
    nowIso = new Date().toISOString(),
  ): ApprovedLeaveRecord {
    const existing = this.getLeaveById(guildId, leaveId);
    if (!existing) throw new Error(`Leave record ${leaveId} not found.`);
    if (existing.status === 'CANCELLED' || existing.status === 'REJECTED' || existing.status === 'COMPLETED') {
      throw new Error(`Leave ${leaveId} is already ${existing.status}.`);
    }

    this.db.run(
      `UPDATE approved_leave SET
        status = 'CANCELLED',
        decision_note = ?,
        updated_at = ?
      WHERE guild_id = ? AND leave_id = ?`,
      [reason.trim() || 'Cancelled', nowIso, guildId, leaveId],
    );

    const updated = this.getLeaveById(guildId, leaveId)!;
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'LEAVE',
      actionType: 'LEAVE_CANCELLED',
      targetType: 'LEAVE',
      targetId: leaveId,
      before: existing,
      after: updated,
    });
    return updated;
  }

  /**
   * Transitions APPROVED leaves whose start_at <= now into ACTIVE,
   * and ACTIVE/APPROVED leaves whose end_at < now into COMPLETED so monitoring resumes automatically!
   */
  public refreshGuildLeaveLifecycle(guildId: string, nowIso = new Date().toISOString()): {
    activatedCount: number;
    completedCount: number;
  } {
    const activated = this.db.run(
      `UPDATE approved_leave SET status = 'ACTIVE', updated_at = ?
       WHERE guild_id = ? AND status = 'APPROVED' AND start_at <= ? AND end_at >= ?`,
      [nowIso, guildId, nowIso, nowIso],
    );

    const completed = this.db.run(
      `UPDATE approved_leave SET status = 'COMPLETED', updated_at = ?
       WHERE guild_id = ? AND status IN ('APPROVED', 'ACTIVE') AND end_at < ?`,
      [nowIso, guildId, nowIso],
    );

    return {
      activatedCount: activated.changes,
      completedCount: completed.changes,
    };
  }

  public getActiveLeaveForStaff(
    guildId: string,
    staffUserId: string,
    atIso = new Date().toISOString(),
  ): ApprovedLeaveRecord | undefined {
    this.refreshGuildLeaveLifecycle(guildId, atIso);
    return this.db.get<ApprovedLeaveRecord>(
      `SELECT * FROM approved_leave
       WHERE guild_id = ? AND staff_user_id = ?
         AND status IN ('APPROVED', 'ACTIVE')
         AND start_at <= ? AND end_at >= ?
       ORDER BY end_at DESC LIMIT 1`,
      [guildId, staffUserId, atIso, atIso],
    );
  }

  public getMostRecentCompletedLeaveEnd(guildId: string, staffUserId: string, beforeIso: string): string | null {
    const row = this.db.get<{ end_at: string }>(
      `SELECT end_at FROM approved_leave
       WHERE guild_id = ? AND staff_user_id = ?
         AND status = 'COMPLETED' AND end_at <= ?
       ORDER BY end_at DESC LIMIT 1`,
      [guildId, staffUserId, beforeIso],
    );
    return row?.end_at ?? null;
  }

  public getLeaveById(guildId: string, leaveId: string): ApprovedLeaveRecord | undefined {
    return this.db.get<ApprovedLeaveRecord>(
      'SELECT * FROM approved_leave WHERE guild_id = ? AND leave_id = ?',
      [guildId, leaveId],
    );
  }

  public listGuildLeave(
    guildId: string,
    options?: { activeOnly?: boolean; staffUserId?: string; limit?: number },
  ): ApprovedLeaveRecord[] {
    this.refreshGuildLeaveLifecycle(guildId);
    const clauses = ['guild_id = ?'];
    const params: unknown[] = [guildId];

    if (options?.activeOnly) {
      clauses.push("status IN ('PENDING', 'APPROVED', 'ACTIVE')");
    }
    if (options?.staffUserId) {
      clauses.push('staff_user_id = ?');
      params.push(options.staffUserId);
    }

    params.push(options?.limit ?? 30);
    return this.db.all<ApprovedLeaveRecord>(
      `SELECT * FROM approved_leave WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
  }
}
