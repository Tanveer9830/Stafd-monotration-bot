import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

describe('Section 4, 5, 6 & 20: Complete Staff Roster, Activity Classifier & Scheduled Scanner', () => {
  let fx: RealDiskTestFixture;
  const guildId = '210000000000000001';
  const ownerId = '310000000000000001';
  const modRoleId = '710000000000000001';
  const trialRoleId = '710000000000000002';
  const ticketCategoryId = '810000000000000001';

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Roster Guild', ownerId);
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId: modRoleId,
      roleName: 'Moderator',
      category: 'MODERATOR',
    });
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId: trialRoleId,
      roleName: 'Trial Staff',
      category: 'TRIAL_STAFF',
    });
    fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CATEGORY',
      channelId: ticketCategoryId,
      channelName: 'Support Tickets',
      adapterType: 'generic',
    });
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('synchronizes multiple staff roles and preserves historical records when staff leave and rejoin', async () => {
    const staff1 = '610000000000000001';
    const staff2 = '610000000000000002';
    const regularUser = '610000000000000099';

    const sync1 = fx.container.roster.syncGuildRoster(
      guildId,
      [
        { userId: staff1, username: 'alice_mod', displayName: 'Alice', roleIds: [modRoleId, trialRoleId] },
        { userId: staff2, username: 'bob_trial', displayName: 'Bob', roleIds: [trialRoleId] },
        { userId: regularUser, username: 'member', displayName: 'Member', roleIds: [] },
      ],
      { nowIso: '2026-11-01T00:00:00.000Z' },
    );

    expect(sync1.activeStaffCount).toBe(2);
    expect(sync1.newlyRegistered).toEqual([staff1, staff2]);

    // Issue a warning to Alice so she has historical records
    await fx.container.warnings.issueWarning({
      guildId,
      staffUserId: staff1,
      reason: 'Historical warning test',
      issuedById: ownerId,
      approverId: ownerId,
      approverDisplayName: 'GuildOwner',
      nowIso: '2026-11-01T02:00:00.000Z',
    });

    // Alice leaves the server and Bob loses his Trial Staff role
    const sync2 = fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: staff2, username: 'bob_trial', displayName: 'Bob', roleIds: [] }],
      { nowIso: '2026-11-02T00:00:00.000Z' },
    );

    expect(sync2.leftGuildStaff).toContain(staff1);
    expect(sync2.removedFromStaff).toContain(staff2);
    expect(fx.container.roster.listStaffProfiles(guildId, { onlyActiveStaff: true })).toHaveLength(0);

    // Historical profiles and warnings are preserved intact!
    const preservedAlice = fx.container.roster.getStaffProfile(guildId, staff1)!;
    expect(preservedAlice).toBeDefined();
    expect(preservedAlice.is_currently_staff).toBe(0);
    expect(preservedAlice.left_guild_at).toBe('2026-11-02T00:00:00.000Z');
    expect(preservedAlice.total_warnings_count).toBe(1);

    // Alice rejoins the guild with Moderator role
    const sync3 = fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: staff1, username: 'alice_mod', displayName: 'Alice', roleIds: [modRoleId] }],
      { nowIso: '2026-11-03T00:00:00.000Z' },
    );
    expect(sync3.rejoinedStaff).toContain(staff1);
    const rejoinedAlice = fx.container.roster.getStaffProfile(guildId, staff1)!;
    expect(rejoinedAlice.is_currently_staff).toBe(1);
    expect(rejoinedAlice.total_warnings_count).toBe(1);
    expect(fx.container.roster.getRoleHistory(guildId, staff1).map((h) => h.change_type)).toEqual([
      'REJOINED_GUILD',
      'LEFT_GUILD',
      'ADDED',
    ]);
  });

  it('rejects bots, webhooks, spam, filler, and online presence alone while storing metadata without raw message bodies', () => {
    const staffId = '610000000000000010';
    const supportCh = '810000000000000055';
    fx.container.guildConfig.updateGuildChannels(guildId, ownerId, { supportWorkChannelIds: [supportCh] });
    fx.container.roster.syncGuildRoster(guildId, [
      { userId: staffId, username: 'helper1', displayName: 'Helper 1', roleIds: [modRoleId], presenceStatus: 'online' },
    ]);

    // Online presence alone does NOT set last_qualifying_work_at
    expect(fx.container.roster.getStaffProfile(guildId, staffId)?.last_qualifying_work_at).toBeNull();

    // Bot message rejected
    expect(
      fx.container.classifier.evaluateMessageActivity({
        guildId,
        userId: staffId,
        channelId: supportCh,
        messageId: '900000000000000001',
        content: 'Automated bot announcement message here',
        isBot: true,
      }).isQualifying,
    ).toBe(false);

    // Webhook rejected
    expect(
      fx.container.classifier.evaluateMessageActivity({
        guildId,
        userId: staffId,
        channelId: supportCh,
        messageId: '900000000000000002',
        content: 'Webhook relay message here',
        isWebhook: true,
      }).isQualifying,
    ).toBe(false);

    // Short filler ("ok") rejected
    expect(
      fx.container.classifier.evaluateMessageActivity({
        guildId,
        userId: staffId,
        channelId: supportCh,
        messageId: '900000000000000003',
        content: 'ok',
      }).isQualifying,
    ).toBe(false);

    // Meaningful support reply accepted — raw secret text NEVER stored in DB!
    const secretPhrase = 'Please reset your 2FA backup settings under User Settings > Security tab';
    const accepted = fx.container.classifier.evaluateMessageActivity({
      guildId,
      userId: staffId,
      channelId: supportCh,
      messageId: '900000000000000004',
      content: secretPhrase,
      occurredAt: '2026-11-05T10:00:00.000Z',
    });
    expect(accepted.isQualifying).toBe(true);

    // Duplicate identical message within 2m rejected as spam
    const dup = fx.container.classifier.evaluateMessageActivity({
      guildId,
      userId: staffId,
      channelId: supportCh,
      messageId: '900000000000000005',
      content: secretPhrase,
      occurredAt: '2026-11-05T10:00:30.000Z',
    });
    expect(dup.isQualifying).toBe(false);

    // Verify raw message body is NOT stored in activity_events
    const storedEvents = fx.container.classifier.listStaffActivityEvents(guildId, staffId);
    expect(storedEvents).toHaveLength(1);
    expect(storedEvents[0].metadata_json).not.toContain('backup settings');
  });

  it('accurately classifies NEW_STAFF, INSUFFICIENT_WORKLOAD, AT_RISK (24h), INACTIVE (48h), ESCALATED (72h), ON_LEAVE, PARTIAL, MONITORING_ERROR & auto-cancels on resumption', async () => {
    const sActive = '610000000000000101';
    const sAtRisk = '610000000000000102';
    const sInactive = '610000000000000103';
    const sEscalated = '610000000000000104';
    const sLeave = '610000000000000105';
    const sNew = '610000000000000106';

    const baseJoin = '2026-11-01T00:00:00.000Z';
    fx.container.roster.syncGuildRoster(
      guildId,
      [
        { userId: sActive, username: 'active_u', displayName: 'Active', roleIds: [modRoleId] },
        { userId: sAtRisk, username: 'risk_u', displayName: 'AtRisk', roleIds: [modRoleId] },
        { userId: sInactive, username: 'inact_u', displayName: 'Inactive', roleIds: [modRoleId] },
        { userId: sEscalated, username: 'esc_u', displayName: 'Escalated', roleIds: [modRoleId] },
        { userId: sLeave, username: 'leave_u', displayName: 'OnLeave', roleIds: [modRoleId] },
      ],
      { nowIso: baseJoin },
    );

    // Register sNew only 4 hours before scan -> should be NEW_STAFF
    fx.container.roster.syncGuildRoster(
      guildId,
      [
        { userId: sActive, username: 'active_u', displayName: 'Active', roleIds: [modRoleId] },
        { userId: sAtRisk, username: 'risk_u', displayName: 'AtRisk', roleIds: [modRoleId] },
        { userId: sInactive, username: 'inact_u', displayName: 'Inactive', roleIds: [modRoleId] },
        { userId: sEscalated, username: 'esc_u', displayName: 'Escalated', roleIds: [modRoleId] },
        { userId: sLeave, username: 'leave_u', displayName: 'OnLeave', roleIds: [modRoleId] },
        { userId: sNew, username: 'new_u', displayName: 'NewStaff', roleIds: [trialRoleId] },
      ],
      { nowIso: '2026-11-05T08:00:00.000Z' },
    );

    const scanTime = '2026-11-05T12:00:00.000Z';

    // Give qualifying activity at exact offsets before scanTime (2026-11-05T12:00Z):
    // sActive: 5h ago (07:00Z)
    // sAtRisk: 30h ago (Nov 4 06:00Z)
    // sInactive: 52h ago (Nov 3 08:00Z)
    // sEscalated: 80h ago (Nov 2 04:00Z)
    fx.container.classifier.recordExplicitStaffWork({
      guildId,
      userId: sActive,
      eventType: 'MODERATION_ACTION',
      reason: 'Mod action',
      occurredAt: '2026-11-05T07:00:00.000Z',
    });
    fx.container.classifier.recordExplicitStaffWork({
      guildId,
      userId: sAtRisk,
      eventType: 'MODERATION_ACTION',
      reason: 'Mod action',
      occurredAt: '2026-11-04T06:00:00.000Z',
    });
    fx.container.classifier.recordExplicitStaffWork({
      guildId,
      userId: sInactive,
      eventType: 'MODERATION_ACTION',
      reason: 'Mod action',
      occurredAt: '2026-11-03T08:00:00.000Z',
    });
    fx.container.classifier.recordExplicitStaffWork({
      guildId,
      userId: sEscalated,
      eventType: 'MODERATION_ACTION',
      reason: 'Mod action',
      occurredAt: '2026-11-02T04:00:00.000Z',
    });

    // Put sLeave on approved leave covering scanTime
    fx.container.leave.submitLeaveRequest({
      guildId,
      staffUserId: sLeave,
      requestedById: ownerId,
      autoApproveById: ownerId,
      reason: 'University exams',
      startAt: '2026-11-03T00:00:00.000Z',
      endAt: '2026-11-07T00:00:00.000Z',
      nowIso: '2026-11-03T00:00:00.000Z',
    });

    // SUB-CASE A: Zero tickets exist in the server -> idle staff must be INSUFFICIENT_WORKLOAD, never INACTIVE!
    const zeroWorkScan = await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: scanTime,
    });
    expect(zeroWorkScan.statusCounts.ACTIVE).toBe(1);
    expect(zeroWorkScan.statusCounts.ON_LEAVE).toBe(1);
    expect(zeroWorkScan.statusCounts.NEW_STAFF).toBe(1);
    expect(zeroWorkScan.statusCounts.INSUFFICIENT_WORKLOAD).toBe(3);
    expect(zeroWorkScan.reviewsCreated).toBe(0);

    // SUB-CASE B: Create an open unassigned ticket so workload opportunity exists,
    // BUT simulate PARTIAL channel coverage -> must classify as UNKNOWN and NEVER create formal warning review!
    fx.container.tickets.createTicket({
      guildId,
      channelId: '820000000000000001',
      channelName: 'ticket-0001',
      parentCategoryId: ticketCategoryId,
      openedAt: '2026-11-05T00:00:00.000Z',
    });

    const partialScan = await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: scanTime,
      livePermissionChecks: [
        {
          channelId: ticketCategoryId,
          channelName: 'Support Tickets',
          targetType: 'CATEGORY',
          exists: true,
          canViewChannel: true,
          canReadHistory: true,
          canSendMessages: true,
        },
        {
          channelId: '820000000000000999',
          channelName: 'VIP Tickets',
          targetType: 'CATEGORY',
          exists: true,
          canViewChannel: false,
          canReadHistory: false,
          canSendMessages: false,
        },
      ],
    });
    expect(partialScan.coverageLevel).toBe('PARTIAL');
    expect(partialScan.statusCounts.UNKNOWN).toBe(3);
    expect(partialScan.reviewsCreated).toBe(0);

    // SUB-CASE C: Simulate MONITORING_ERROR (system downtime)
    const downScan = await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: scanTime,
      monitoringSystemDown: true,
      monitoringErrorReason: 'Gateway permission outage',
    });
    expect(downScan.statusCounts.MONITORING_ERROR).toBe(6);
    expect(downScan.reviewsCreated).toBe(0);

    // SUB-CASE D: FULL coverage + available open ticket -> exact AT_RISK (24h+), INACTIVE (48h+), ESCALATED (72h+)!
    const fullScan = await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: scanTime,
    });
    expect(fullScan.coverageLevel).toBe('FULL');
    expect(fullScan.statusCounts.ACTIVE).toBe(1);
    expect(fullScan.statusCounts.AT_RISK).toBe(1);
    expect(fullScan.statusCounts.INACTIVE).toBe(2); // sInactive + sEscalated
    expect(fullScan.statusCounts.ON_LEAVE).toBe(1);
    expect(fullScan.statusCounts.NEW_STAFF).toBe(1);
    expect(fullScan.escalationsTriggered).toBe(1);
    expect(fullScan.reviewsCreated).toBe(2);

    // SUB-CASE E: Qualifying work resumes for sInactive -> pending review is automatically cancelled!
    const pendingBefore = fx.container.reviews.listGuildReviews(guildId, { pendingOnly: true });
    expect(pendingBefore).toHaveLength(2);

    fx.container.classifier.recordExplicitStaffWork({
      guildId,
      userId: sInactive,
      eventType: 'TICKET_RESOLUTION',
      reason: 'Resolved support ticket',
      occurredAt: '2026-11-05T12:15:00.000Z',
    });

    const pendingAfter = fx.container.reviews.listGuildReviews(guildId, { pendingOnly: true });
    expect(pendingAfter).toHaveLength(1);
    expect(pendingAfter[0].staff_user_id).toBe(sEscalated);
  });

  it('persists scheduled scan timestamps across real SQLite restarts without duplicating or losing schedules', async () => {
    fx.container.scheduler.initializeSchedules('2026-11-05T00:00:00.000Z');
    const beforeRestart = fx.container.scheduler.getSchedulerStatus();
    expect(beforeRestart).toHaveLength(1);
    expect(beforeRestart[0].next_run_at).toBe('2026-11-05T06:00:00.000Z');

    // Restart container on the exact same on-disk SQLite file
    const reopened = fx.reopenContainer();
    const afterRestart = reopened.scheduler.getSchedulerStatus();
    expect(afterRestart[0].next_run_at).toBe('2026-11-05T06:00:00.000Z');

    // Not due yet at 04:00Z -> 0 scans executed
    const earlyRun = await reopened.scheduler.runDueTasks('2026-11-05T04:00:00.000Z');
    expect(earlyRun).toHaveLength(0);

    // Due at 06:01Z -> executes scheduled scan and advances next_run_at by 6 hours!
    const dueRun = await reopened.scheduler.runDueTasks('2026-11-05T06:01:00.000Z');
    expect(dueRun).toHaveLength(1);
    const updatedSchedule = reopened.scheduler.getSchedulerStatus()[0];
    expect(updatedSchedule.run_count).toBe(1);
    expect(updatedSchedule.next_run_at).toBe('2026-11-05T12:01:00.000Z');
  });
});
