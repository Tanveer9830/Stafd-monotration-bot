import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GLOBAL_OWNER_ID, PERMANENT_EMBED_FOOTER } from '../src/config/branding';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

describe('Section 8, 9, 10 & 20: Persistent Reviews, Warning Progression, DM Fallbacks, Appeals & Leave', () => {
  let fx: RealDiskTestFixture;
  const guildId = '230000000000000001';
  const ownerId = '330000000000000001';
  const reviewer2Id = '330000000000000002';
  const unauthorizedUserId = '330000000000000099';
  const staffId = '630000000000000001';
  const staffRoleId = '730000000000000001';
  const fallbackChannelId = '830000000000000999';

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Review Guild', ownerId);
    fx.container.guildConfig.updateGuildChannels(guildId, ownerId, {
      fallbackReviewChannelId: fallbackChannelId,
      alertChannelId: fallbackChannelId,
    });
    fx.container.permissions.setGuildPermissionAssignment(
      { userId: ownerId, guildId, actualGuildOwnerId: ownerId },
      { targetType: 'USER', targetId: reviewer2Id, permissionLevel: 'MANAGEMENT_REVIEWER' },
    );
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId: staffRoleId,
      roleName: 'Staff',
      category: 'STAFF',
    });
    fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CATEGORY',
      channelId: '830000000000000001',
      channelName: 'Tickets',
    });
    fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: staffId, username: 'target_staff', displayName: 'Target Staff', roleIds: [staffRoleId] }],
      { nowIso: '2026-11-01T00:00:00.000Z' },
    );
    fx.container.tickets.createTicket({
      guildId,
      channelId: '830000000000000010',
      channelName: 'ticket-10',
      parentCategoryId: '830000000000000001',
      openedAt: '2026-11-02T00:00:00.000Z',
    });
  });

  afterEach(() => {
    fx.cleanup();
  });

  async function triggerInactiveReview(nowIso = '2026-11-04T00:00:00.000Z') {
    const scan = await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso,
    });
    expect(scan.reviewsCreated).toBe(1);
    return fx.container.reviews.listGuildReviews(guildId, { pendingOnly: true })[0];
  }

  it('retains Global Owner review notifications in Global Inbox & sends fallback when Global Owner DMs are disabled', async () => {
    fx.delivery.failingDmUserIds.add(GLOBAL_OWNER_ID);
    const review = await triggerInactiveReview();

    const inbox = fx.container.notifications.listGlobalOwnerInbox(GLOBAL_OWNER_ID);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].reference_id).toBe(review.review_id);
    expect(inbox[0].delivery_channel).toBe('CHANNEL_FALLBACK');

    // Channel fallback fired once
    const fallbackMsgs = fx.delivery.sent.filter((m) => m.targetType === 'CHANNEL' && m.targetId === fallbackChannelId);
    expect(fallbackMsgs).toHaveLength(1);
    expect(fallbackMsgs[0].payload.embeds[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
  });

  it('rejects unauthorized approvals, enforces Two-Person / Global-Owner policies, requires Final Confirmation, and checks live role/activity before issuing', async () => {
    // Switch to TWO_PERSON_APPROVAL policy
    fx.container.guildConfig.updateGlobalSecurityConfig(GLOBAL_OWNER_ID, {
      globalApprovalPolicy: 'TWO_PERSON_APPROVAL',
    });

    const review = await triggerInactiveReview('2026-11-04T00:00:00.000Z');

    // 1. Unauthorized user rejected
    await expect(
      fx.container.reviews.initiateWarningApproval(
        { userId: unauthorizedUserId, guildId, actualGuildOwnerId: ownerId },
        review.review_id,
      ),
    ).rejects.toThrow(/Access Denied/i);

    // 2. First authorized reviewer (Owner) approves -> AWAITING_SECOND_APPROVAL
    const step1 = await fx.container.reviews.initiateWarningApproval(
      { userId: ownerId, guildId, actualGuildOwnerId: ownerId },
      review.review_id,
      { proposedReason: '48h unexcused inactivity', actorDisplayName: 'ServerOwner', nowIso: '2026-11-04T01:00:00.000Z' },
    );
    expect(step1.stage).toBe('AWAITING_SECOND_APPROVAL');

    // Same reviewer cannot self-confirm second step!
    await expect(
      fx.container.reviews.initiateWarningApproval(
        { userId: ownerId, guildId, actualGuildOwnerId: ownerId },
        review.review_id,
        { nowIso: '2026-11-04T01:05:00.000Z' },
      ),
    ).rejects.toThrow(/distinct second authorized reviewer/i);

    // 3. Second reviewer initiates -> AWAITING_FINAL_CONFIRMATION
    const step2 = await fx.container.reviews.initiateWarningApproval(
      { userId: reviewer2Id, guildId, actualGuildOwnerId: ownerId },
      review.review_id,
      {
        proposedReason: '48h unexcused inactivity',
        proposedNote: 'Please check in with team lead',
        // Try spoofing display name as "Tanveer" when not Global Owner -> must be sanitized!
        actorDisplayName: 'Tanveer Spoof',
        nowIso: '2026-11-04T01:10:00.000Z',
      },
    );
    expect(step2.stage).toBe('AWAITING_FINAL_CONFIRMATION');

    // 4. Final Confirmation issues Warning 1/3, delivers DM, and records actual approver ID (never false Tanveer attribution!)
    const finalized = await fx.container.reviews.finalizeWarningConfirmation(
      { userId: reviewer2Id, guildId, actualGuildOwnerId: ownerId },
      review.review_id,
      'Tanveer Spoof',
      undefined,
      undefined,
      '2026-11-04T01:12:00.000Z',
    );

    expect(finalized.warning).not.toBeNull();
    expect(finalized.warning!.warning_level).toBe(1);
    expect(finalized.warning!.approver_id).toBe(reviewer2Id);
    expect(finalized.warning!.approver_display_name).not.toMatch(/tanveer/i);
    expect(finalized.warning!.dm_delivered).toBe(1);

    // Verify staff DM embed has permanent Tanveer footer
    const staffDm = fx.delivery.sent.find((m) => m.targetType === 'DM' && m.targetId === staffId)!;
    expect(staffDm).toBeDefined();
    expect(staffDm.payload.embeds[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
  });

  it('supports REJECT, REVIEW LATER, MARK EXCUSED, and auto-cancels confirmation if staff loses role before final confirm', async () => {
    const rev1 = await triggerInactiveReview('2026-11-04T00:00:00.000Z');
    const ownerCtx = { userId: ownerId, guildId, actualGuildOwnerId: ownerId };

    // Defer later
    const deferred = fx.container.reviews.deferReviewLater(ownerCtx, rev1.review_id, 6, 'Wait 6h', '2026-11-04T01:00:00.000Z');
    expect(deferred.status).toBe('DEFERRED');

    // Reject
    const rejected = fx.container.reviews.rejectReview(ownerCtx, rev1.review_id, 'Owner', 'False alarm', '2026-11-04T02:00:00.000Z');
    expect(rejected.status).toBe('REJECTED');

    // Create a second review & mark excused
    const rev2 = await triggerInactiveReview('2026-11-05T00:00:00.000Z');
    const excused = fx.container.reviews.markReviewExcused(ownerCtx, rev2.review_id, 'Owner', 'Hardware outage', '2026-11-05T01:00:00.000Z');
    expect(excused.status).toBe('EXCUSED');

    // Create a third review, initiate approval, then remove staff role BEFORE final confirm -> must auto-cancel!
    const rev3 = await triggerInactiveReview('2026-11-06T00:00:00.000Z');
    const init = await fx.container.reviews.initiateWarningApproval(ownerCtx, rev3.review_id, {
      nowIso: '2026-11-06T01:00:00.000Z',
    });
    expect(init.stage).toBe('AWAITING_FINAL_CONFIRMATION');

    // Staff member loses staff role
    fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: staffId, username: 'target_staff', displayName: 'Target Staff', roleIds: [] }],
      { nowIso: '2026-11-06T01:02:00.000Z' },
    );

    const confirmRes = await fx.container.reviews.finalizeWarningConfirmation(
      ownerCtx,
      rev3.review_id,
      'Owner',
      undefined,
      undefined,
      '2026-11-06T01:05:00.000Z',
    );
    expect(confirmRes.warning).toBeNull();
    expect(confirmRes.review.status).toBe('CANCELLED');
    expect(confirmRes.autoCancelledReason).toMatch(/no longer holds a configured staff role/i);
  });

  it('progresses Warning 1/3 -> 2/3 -> 3/3 (Management Review Only), handles DM failure, removal audit, expiration & appeals', async () => {
    // Simulate Staff DMs disabled!
    fx.delivery.failingDmUserIds.add(staffId);

    const w1 = await fx.container.warnings.issueWarning({
      guildId,
      staffUserId: staffId,
      reason: 'Inactivity case #1',
      issuedById: ownerId,
      approverId: ownerId,
      approverDisplayName: 'Owner',
      nowIso: '2026-08-01T00:00:00.000Z',
    });
    expect(w1.warning_level).toBe(1);
    expect(w1.dm_delivered).toBe(0);
    expect(w1.dm_error).toContain('DMs disabled');
    expect(w1.fallback_notified).toBe(1);

    // Warning 1 expires after 90 days (by Nov 11, 2026)!
    const expiredCount = fx.container.warnings.expireElapsedWarnings(guildId, '2026-11-11T00:00:00.000Z');
    expect(expiredCount).toBe(1);
    expect(fx.container.roster.getStaffProfile(guildId, staffId)?.active_warnings_count).toBe(0);

    // Now issue 3 active warnings in Nov 2026 -> 1/3, 2/3, 3/3
    fx.delivery.failingDmUserIds.delete(staffId);
    const a1 = await fx.container.warnings.issueWarning({
      guildId,
      staffUserId: staffId,
      reason: 'Active warn 1',
      issuedById: ownerId,
      approverId: ownerId,
      approverDisplayName: 'Owner',
      nowIso: '2026-11-08T00:00:00.000Z',
    });
    const a2 = await fx.container.warnings.issueWarning({
      guildId,
      staffUserId: staffId,
      reason: 'Active warn 2',
      issuedById: ownerId,
      approverId: ownerId,
      approverDisplayName: 'Owner',
      nowIso: '2026-11-09T00:00:00.000Z',
    });
    const a3 = await fx.container.warnings.issueWarning({
      guildId,
      staffUserId: staffId,
      reason: 'Active warn 3',
      issuedById: GLOBAL_OWNER_ID,
      approverId: GLOBAL_OWNER_ID,
      approverDisplayName: 'Tanveer',
      nowIso: '2026-11-10T00:00:00.000Z',
    });

    expect(a1.warning_level).toBe(1);
    expect(a2.warning_level).toBe(2);
    expect(a3.warning_level).toBe(3);
    expect(a3.requires_management_review).toBe(1);
    expect(a3.approver_display_name).toBe('Tanveer');

    // Verify staff member is STILL active staff (NEVER auto-kicked/banned/demoted!)
    const prof = fx.container.roster.getStaffProfile(guildId, staffId)!;
    expect(prof.is_currently_staff).toBe(1);
    expect(prof.active_warnings_count).toBe(3);

    // Removal requires mandatory reason
    expect(() =>
      fx.container.warnings.removeWarning({
        guildId,
        warningId: a1.warning_id,
        actorUserId: ownerId,
        removalReason: '',
      }),
    ).toThrow(/mandatory/i);

    const removed = fx.container.warnings.removeWarning({
      guildId,
      warningId: a1.warning_id,
      actorUserId: ownerId,
      removalReason: 'Verified medical documentation supplied',
      nowIso: '2026-11-10T05:00:00.000Z',
    });
    expect(removed.status).toBe('REMOVED');
    expect(fx.container.roster.getStaffProfile(guildId, staffId)?.active_warnings_count).toBe(2);

    // Staff submits appeal on a2 -> management approves -> warning overturned!
    const appeal = fx.container.warnings.submitAppeal({
      guildId,
      warningId: a2.warning_id,
      staffUserId: staffId,
      appealReason: 'Power grid outage in region for 48 hours',
      nowIso: '2026-11-10T06:00:00.000Z',
    });
    expect(appeal.status).toBe('PENDING');

    const decided = fx.container.warnings.decideAppeal({
      guildId,
      appealId: appeal.appeal_id,
      actorUserId: ownerId,
      actorDisplayName: 'Owner',
      decision: 'APPROVED',
      decisionNote: 'Confirmed regional outage',
      nowIso: '2026-11-10T07:00:00.000Z',
    });
    expect(decided.status).toBe('APPROVED');
    expect(fx.container.warnings.getWarningById(guildId, a2.warning_id)?.status).toBe('APPEALED_OVERTURNED');
    expect(fx.container.roster.getStaffProfile(guildId, staffId)?.active_warnings_count).toBe(1);
  });

  it('manages leave requests, approvals, rejections, cancellations, and automatic post-leave resumption', async () => {
    const req = fx.container.leave.submitLeaveRequest({
      guildId,
      staffUserId: staffId,
      requestedById: staffId,
      reason: 'Family wedding trip',
      startAt: '2026-11-12T00:00:00.000Z',
      endAt: '2026-11-15T00:00:00.000Z',
      nowIso: '2026-11-11T00:00:00.000Z',
    });
    expect(req.status).toBe('PENDING');

    const approved = fx.container.leave.approveLeave(
      guildId,
      req.leave_id,
      ownerId,
      'Approved — enjoy!',
      '2026-11-11T01:00:00.000Z',
    );
    expect(approved.status).toBe('APPROVED');

    // During leave (Nov 13), staff is ON_LEAVE
    const duringLeave = fx.container.leave.getActiveLeaveForStaff(guildId, staffId, '2026-11-13T12:00:00.000Z');
    expect(duringLeave?.status).toBe('ACTIVE');

    // After leave ends (Nov 15 10:00Z — 10h after end_at), leave transitions to COMPLETED and staff enters ACTIVE grace window!
    const afterLeave = fx.container.leave.getActiveLeaveForStaff(guildId, staffId, '2026-11-15T10:00:00.000Z');
    expect(afterLeave).toBeUndefined();
    expect(fx.container.leave.getLeaveById(guildId, req.leave_id)?.status).toBe('COMPLETED');

    const postLeaveScan = await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: '2026-11-15T10:00:00.000Z',
    });
    expect(postLeaveScan.statusCounts.ACTIVE).toBe(1);
    expect(postLeaveScan.reviewsCreated).toBe(0);
  });
});
