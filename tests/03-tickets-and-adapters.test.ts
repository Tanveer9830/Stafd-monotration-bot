import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

describe('Section 7 & 20: Ticket Monitoring Engine, Adapters & Diagnostics', () => {
  let fx: RealDiskTestFixture;
  const guildId = '220000000000000001';
  const ownerId = '320000000000000001';
  const staffA = '620000000000000001';
  const staffB = '620000000000000002';
  const supportRole = '720000000000000001';
  const ticketCategory = '820000000000000001';

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Ticket Guild', ownerId);
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId: supportRole,
      roleName: 'Support Team',
      category: 'SUPPORT_TEAM',
    });
    fx.container.roster.syncGuildRoster(guildId, [
      { userId: staffA, username: 'agent_a', displayName: 'Agent A', roleIds: [supportRole] },
      { userId: staffB, username: 'agent_b', displayName: 'Agent B', roleIds: [supportRole] },
    ]);
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('tracks full ticket lifecycle, deduplicates duplicate events, and does NOT count claiming alone as handled work', () => {
    fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CATEGORY',
      channelId: ticketCategory,
      channelName: 'Support Category',
      adapterType: 'generic',
    });

    // 1. Creation + duplicate creation deduplication
    const created1 = fx.container.tickets.createTicket({
      guildId,
      channelId: '820000000000000101',
      channelName: 'ticket-0101',
      parentCategoryId: ticketCategory,
      openerUserId: '990000000000000001',
      sourceEventId: 'evt:create:101',
      openedAt: '2026-11-10T10:00:00.000Z',
    });
    expect(created1.deduplicated).toBe(false);

    const createdDup = fx.container.tickets.createTicket({
      guildId,
      channelId: '820000000000000101',
      channelName: 'ticket-0101',
      parentCategoryId: ticketCategory,
      sourceEventId: 'evt:create:101',
      openedAt: '2026-11-10T10:00:00.000Z',
    });
    expect(createdDup.deduplicated).toBe(true);

    const ticketId = created1.ticket.ticket_id;

    // 2. Staff A claims ticket — must NOT count as handled or qualifying work!
    fx.container.tickets.claimTicket({
      guildId,
      ticketId,
      staffUserId: staffA,
      sourceEventId: 'evt:claim:101',
      occurredAt: '2026-11-10T10:02:00.000Z',
    });

    const profAAfterClaim = fx.container.roster.getStaffProfile(guildId, staffA)!;
    expect(profAAfterClaim.assigned_tickets_count).toBe(1);
    expect(profAAfterClaim.current_workload).toBe(1);
    expect(profAAfterClaim.tickets_handled_count).toBe(0);
    expect(profAAfterClaim.last_qualifying_work_at).toBeNull();

    // 3. Reassignment to Staff B
    fx.container.tickets.assignOrReassignTicket({
      guildId,
      ticketId,
      staffUserId: staffB,
      actorUserId: ownerId,
      sourceEventId: 'evt:reassign:101',
      occurredAt: '2026-11-10T10:03:00.000Z',
    });
    expect(fx.container.roster.getStaffProfile(guildId, staffA)?.current_workload).toBe(0);
    expect(fx.container.roster.getStaffProfile(guildId, staffB)?.current_workload).toBe(1);

    // 4. Meaningful first response by Staff B (5 minutes = 300s after open)
    const msgRes = fx.container.tickets.recordTicketStaffMessage({
      guildId,
      ticketId,
      staffUserId: staffB,
      channelId: '820000000000000101',
      messageId: '950000000000000001',
      content: 'Hello! I have reviewed your account billing issue and applied the credit.',
      contentAvailable: true,
      occurredAt: '2026-11-10T10:05:00.000Z',
    });
    expect(msgRes.qualifyingWork).toBe(true);
    expect(msgRes.isFirstResponse).toBe(true);
    expect(msgRes.ticket.first_response_sec).toBe(300);

    // Duplicate message delivery ignored
    const msgDup = fx.container.tickets.recordTicketStaffMessage({
      guildId,
      ticketId,
      staffUserId: staffB,
      channelId: '820000000000000101',
      messageId: '950000000000000001',
      content: 'Hello! I have reviewed your account billing issue and applied the credit.',
      contentAvailable: true,
      occurredAt: '2026-11-10T10:05:00.000Z',
    });
    expect(msgDup.deduplicated).toBe(true);

    const profBAfterReply = fx.container.roster.getStaffProfile(guildId, staffB)!;
    expect(profBAfterReply.tickets_handled_count).toBe(1);
    expect(profBAfterReply.avg_first_response_sec).toBe(300);

    // 5. Resolution (15m = 900s) -> Closure -> Reopening -> Re-closure
    const resolved = fx.container.tickets.resolveTicket({
      guildId,
      ticketId,
      staffUserId: staffB,
      sourceEventId: 'evt:resolve:101',
      occurredAt: '2026-11-10T10:15:00.000Z',
    });
    expect(resolved.ticket.status).toBe('RESOLVED');
    expect(resolved.ticket.resolution_sec).toBe(900);
    expect(fx.container.roster.getStaffProfile(guildId, staffB)?.tickets_resolved_count).toBe(1);
    expect(fx.container.roster.getStaffProfile(guildId, staffB)?.current_workload).toBe(0);

    const closed = fx.container.tickets.closeTicket({
      guildId,
      ticketId,
      actorUserId: staffB,
      sourceEventId: 'evt:close:101',
      occurredAt: '2026-11-10T10:16:00.000Z',
    });
    expect(closed.ticket.status).toBe('CLOSED');

    const reopened = fx.container.tickets.reopenTicket({
      guildId,
      ticketId,
      actorUserId: '990000000000000001',
      sourceEventId: 'evt:reopen:101',
      occurredAt: '2026-11-10T10:20:00.000Z',
    });
    expect(reopened.ticket.status).toBe('REOPENED');
    expect(reopened.ticket.reopened_count).toBe(1);
    expect(fx.container.roster.getStaffProfile(guildId, staffB)?.current_workload).toBe(1);
  });

  it('parses Ticket Tool & Tickets v2 bot embeds and safely handles unsupported adapter names', () => {
    // Unsupported adapter falls back safely to generic with explicit warning
    const unsupportedCfg = fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CHANNEL',
      channelId: '820000000000000555',
      channelName: 'legacy-tickets',
      adapterType: 'nonexistent-bot-xyz',
    });
    expect(unsupportedCfg.record.adapter_type).toBe('generic');
    expect(unsupportedCfg.adapterWarning).toContain('not natively registered');

    // Configure Ticket Tool category
    fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CATEGORY',
      channelId: ticketCategory,
      channelName: 'Ticket Tool Category',
      adapterType: 'ticket-tool',
    });

    // Simulate Ticket Tool posting a "Ticket Claimed" embed mentioning staffA
    fx.container.tickets.handleBotAdapterMessage({
      guildId,
      channelId: '820000000000000777',
      channelName: 'ticket-0777',
      parentCategoryId: ticketCategory,
      messageId: '960000000000000001',
      authorId: '557628352828014614', // Ticket Tool
      authorIsBot: true,
      embeds: [
        {
          title: 'Ticket Claimed',
          description: `This ticket will be handled by <@${staffA}>`,
        },
      ],
      occurredAt: '2026-11-10T11:00:00.000Z',
    });

    const claimedTicket = fx.container.tickets.getOpenTicketByChannel(guildId, '820000000000000777')!;
    expect(claimedTicket).toBeDefined();
    expect(claimedTicket.claimed_by_user_id).toBe(staffA);
    expect(claimedTicket.status).toBe('CLAIMED');

    // Simulate Ticket Tool posting a "Ticket Closed" embed
    fx.container.tickets.handleBotAdapterMessage({
      guildId,
      channelId: '820000000000000777',
      channelName: 'closed-0777',
      parentCategoryId: ticketCategory,
      messageId: '960000000000000002',
      authorId: '557628352828014614',
      authorIsBot: true,
      embeds: [{ description: `Ticket Closed by <@${staffA}>` }],
      occurredAt: '2026-11-10T11:30:00.000Z',
    });

    const closedTicket = fx.container.tickets.getOpenTicketByChannel(guildId, '820000000000000777')!;
    expect(closedTicket.status).toBe('CLOSED');
    // Since staffA only claimed and sent 0 meaningful responses, resolved_by_user_id remains null!
    expect(closedTicket.resolved_by_user_id).toBeNull();
  });
});
