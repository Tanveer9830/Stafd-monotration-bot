import { ChannelType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dashboardCommand } from '../src/commands/dashboardCommand';
import { ownerCommand } from '../src/commands/ownerCommand';
import { reviewCommand } from '../src/commands/reviewCommand';
import { settingsCommand } from '../src/commands/settingsCommand';
import { staffCommand } from '../src/commands/staffCommand';
import { ticketCommand } from '../src/commands/ticketCommand';
import { warningCommand } from '../src/commands/warningCommand';
import { GLOBAL_OWNER_ID, PERMANENT_EMBED_FOOTER } from '../src/config/branding';
import { createRealSqliteTestFixture, RealDiskTestFixture } from './helpers/testHarness';

interface MockReplyRecord {
  embeds?: Array<{ toJSON(): { title?: string; description?: string; footer?: { text?: string } } }>;
  files?: unknown[];
  components?: unknown[];
}

function createMockCommandInteraction(params: {
  commandName: string;
  subcommandGroup?: string | null;
  subcommand?: string;
  userId: string;
  username?: string;
  guildId?: string;
  guildName?: string;
  guildOwnerId?: string;
  memberRoleIds?: string[];
  strings?: Record<string, string>;
  integers?: Record<string, number>;
  booleans?: Record<string, boolean>;
  users?: Record<string, { id: string; username: string }>;
  roles?: Record<string, { id: string; name: string }>;
  channels?: Record<string, { id: string; name: string; type: ChannelType }>;
}) {
  let captured: MockReplyRecord | null = null;
  const guildId = params.guildId ?? '260000000000000001';
  const guildOwnerId = params.guildOwnerId ?? '360000000000000001';

  const mockGuild = {
    id: guildId,
    name: params.guildName ?? 'Command Test Server',
    ownerId: guildOwnerId,
    members: {
      cache: new Map([
        [
          '660000000000000001',
          {
            id: '660000000000000001',
            displayName: 'Staff One',
            user: { id: '660000000000000001', username: 'staff_one', bot: false },
            roles: { cache: new Map([['760000000000000001', { id: '760000000000000001' }]]) },
            presence: null,
          },
        ],
      ]),
      fetch: async function () {
        return this.cache;
      },
      me: null,
    },
    channels: {
      cache: new Map([
        ['860000000000000001', { id: '860000000000000001', name: 'Tickets' }],
      ]),
    },
  };

  const interaction = {
    commandName: params.commandName,
    user: { id: params.userId, username: params.username ?? 'actor', tag: params.username ?? 'actor' },
    guildId,
    guild: mockGuild,
    member: {
      roles: {
        cache: new Map((params.memberRoleIds ?? []).map((id) => [id, { id }])),
      },
    },
    deferred: false,
    replied: false,
    options: {
      getSubcommandGroup: () => params.subcommandGroup ?? null,
      getSubcommand: () => params.subcommand ?? '',
      getString: (k: string, required?: boolean) => {
        const val = params.strings?.[k] ?? null;
        if (required && val === null) throw new Error(`Missing required string ${k}`);
        return val;
      },
      getInteger: (k: string) => params.integers?.[k] ?? null,
      getBoolean: (k: string) => (params.booleans && k in params.booleans ? params.booleans[k] : null),
      getUser: (k: string, required?: boolean) => {
        const val = params.users?.[k] ?? null;
        if (required && !val) throw new Error(`Missing required user ${k}`);
        return val;
      },
      getRole: (k: string, required?: boolean) => {
        const val = params.roles?.[k] ?? null;
        if (required && !val) throw new Error(`Missing required role ${k}`);
        return val;
      },
      getChannel: (k: string, required?: boolean) => {
        const val = params.channels?.[k] ?? null;
        if (required && !val) throw new Error(`Missing required channel ${k}`);
        return val;
      },
    },
    deferReply: async function () {
      this.deferred = true;
    },
    reply: async function (payload: MockReplyRecord) {
      this.replied = true;
      captured = payload;
    },
    editReply: async function (payload: MockReplyRecord) {
      captured = payload;
    },
    getCaptured: () => captured,
  };

  return interaction;
}

describe('Section 11: End-to-End Slash Command Execution Across All Command Roots', () => {
  let fx: RealDiskTestFixture;
  const guildId = '260000000000000001';
  const ownerId = '360000000000000001';
  const staffId = '660000000000000001';
  const roleId = '760000000000000001';

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('executes /owner, /staff, /ticket, /review, /warning, /settings, and /dashboard commands cleanly', async () => {
    // 1. /staff roles add
    const addRoleInt = createMockCommandInteraction({
      commandName: 'staff',
      subcommandGroup: 'roles',
      subcommand: 'add',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      roles: { role: { id: roleId, name: 'Moderator' } },
      strings: { category: 'MODERATOR' },
    });
    await staffCommand.execute(addRoleInt as never, fx.container);
    expect(addRoleInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

    // 2. /ticket setup
    const ticketSetupInt = createMockCommandInteraction({
      commandName: 'ticket',
      subcommand: 'setup',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      channels: { target: { id: '860000000000000001', name: 'Tickets', type: ChannelType.GuildCategory } },
      strings: { adapter: 'ticket-tool' },
    });
    await ticketCommand.execute(ticketSetupInt as never, fx.container);
    expect(ticketSetupInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Ticket Monitoring Configured');

    // 3. /ticket diagnose
    const diagInt = createMockCommandInteraction({
      commandName: 'ticket',
      subcommand: 'diagnose',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
    });
    await ticketCommand.execute(diagInt as never, fx.container);
    expect(diagInt.getCaptured()?.embeds?.[0].toJSON().description).toContain('FULL');

    // 4. /staff scan
    const scanInt = createMockCommandInteraction({
      commandName: 'staff',
      subcommand: 'scan',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
    });
    await staffCommand.execute(scanInt as never, fx.container);
    expect(scanInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Full Roster Scan Completed');

    // 5. /staff report (PDF export)
    const reportInt = createMockCommandInteraction({
      commandName: 'staff',
      subcommand: 'report',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      strings: { period: 'WEEKLY', format: 'pdf' },
    });
    await staffCommand.execute(reportInt as never, fx.container);
    expect(reportInt.getCaptured()?.files).toHaveLength(1);

    // 6. /settings inactivity
    const inactSetInt = createMockCommandInteraction({
      commandName: 'settings',
      subcommand: 'inactivity',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      integers: { at_risk_hours: 20, inactive_hours: 40, escalation_hours: 60 },
    });
    await settingsCommand.execute(inactSetInt as never, fx.container);
    expect(fx.container.guildConfig.getGuildConfigOrThrow(guildId).inactive_hours).toBe(40);

    // 7. /settings leave (submit)
    const leaveInt = createMockCommandInteraction({
      commandName: 'settings',
      subcommand: 'leave',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      strings: { action: 'submit', start_date: '2026-12-01', end_date: '2026-12-05', reason: 'Annual break' },
      users: { staff: { id: staffId, username: 'staff_one' } },
    });
    await settingsCommand.execute(leaveInt as never, fx.container);
    expect(leaveInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Leave Record Created');

    // 8. /warning issue + /warning profile
    const warnIssueInt = createMockCommandInteraction({
      commandName: 'warning',
      subcommand: 'issue',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      users: { user: { id: staffId, username: 'staff_one' } },
      strings: { reason: 'Manual test warning' },
    });
    await warningCommand.execute(warnIssueInt as never, fx.container);
    expect(warnIssueInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Official Warning Issued');

    // 9. /review pending
    const revPendingInt = createMockCommandInteraction({
      commandName: 'review',
      subcommand: 'pending',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
    });
    await reviewCommand.execute(revPendingInt as never, fx.container);
    expect(revPendingInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Pending Warning Reviews');

    // 10. /dashboard
    const dashInt = createMockCommandInteraction({
      commandName: 'dashboard',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
    });
    await dashboardCommand.execute(dashInt as never, fx.container);
    expect(dashInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Server Management Dashboard');

    // 11. /owner panel (blocks non-owner, succeeds for 1131248987173814336)
    const ownerDeniedInt = createMockCommandInteraction({
      commandName: 'owner',
      subcommand: 'panel',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
    });
    await expect(ownerCommand.execute(ownerDeniedInt as never, fx.container)).rejects.toThrow(/Permanent Global Owner/i);

    const ownerAllowedInt = createMockCommandInteraction({
      commandName: 'owner',
      subcommand: 'panel',
      userId: GLOBAL_OWNER_ID,
      username: 'tanveer5637',
      guildId,
      guildOwnerId: ownerId,
    });
    await ownerCommand.execute(ownerAllowedInt as never, fx.container);
    expect(ownerAllowedInt.getCaptured()?.embeds?.[0].toJSON().title).toContain('Global Owner Command Center');
  });

  it('executes every remaining subcommand across /owner, /staff, /ticket, /review, /warning, and /settings', async () => {
    // Seed guild, staff role, ticket config, staff profile, and an inactivity review
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Command Test Server', ownerId);
    fx.container.roster.addOrUpdateStaffRole(guildId, ownerId, {
      roleId,
      roleName: 'Moderator',
      category: 'MODERATOR',
    });
    fx.container.tickets.addTicketChannelConfig(guildId, ownerId, {
      targetType: 'CATEGORY',
      channelId: '860000000000000001',
      channelName: 'Tickets',
    });
    fx.container.roster.syncGuildRoster(
      guildId,
      [{ userId: staffId, username: 'staff_one', displayName: 'Staff One', roleIds: [roleId] }],
      { nowIso: '2026-11-01T00:00:00.000Z' },
    );
    fx.container.tickets.createTicket({
      guildId,
      channelId: '860000000000000010',
      channelName: 'ticket-10',
      parentCategoryId: '860000000000000001',
      openedAt: '2026-11-02T00:00:00.000Z',
    });

    // --- /owner remaining subcommands ---
    for (const [subGroup, sub, extra] of [
      ['admin', 'add', { users: { user: { id: '460000000000000001', username: 'bot_admin_1' } } }],
      ['admin', 'list', {}],
      ['admin', 'remove', { users: { user: { id: '460000000000000001', username: 'bot_admin_1' } } }],
      [null, 'guilds', {}],
      [null, 'guild-info', { strings: { guild_id: guildId } }],
      [null, 'features', { strings: { feature: 'presence_monitoring' }, booleans: { allowed: false } }],
      [null, 'global-stats', { strings: { export: 'png' } }],
      [null, 'audit', {}],
    ] as const) {
      const i = createMockCommandInteraction({
        commandName: 'owner',
        subcommandGroup: subGroup,
        subcommand: sub,
        userId: GLOBAL_OWNER_ID,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
        ...(extra as object),
      });
      await ownerCommand.execute(i as never, fx.container);
      expect(i.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    // --- /staff remaining subcommands ---
    for (const [subGroup, sub, extra] of [
      [null, 'setup', {}],
      [null, 'list', {}],
      [null, 'active', {}],
      [null, 'inactive', {}],
      [null, 'at-risk', {}],
      [null, 'unknown', {}],
      [null, 'profile', { users: { user: { id: staffId, username: 'staff_one' } } }],
      [null, 'activity', { users: { user: { id: staffId, username: 'staff_one' } } }],
      [null, 'history', { users: { user: { id: staffId, username: 'staff_one' } } }],
      ['roles', 'list', {}],
      [null, 'analytics', {}],
      [null, 'coverage', {}],
      ['roles', 'remove', { roles: { role: { id: '769999999999999999', name: 'Unused' } } }],
    ] as const) {
      const i = createMockCommandInteraction({
        commandName: 'staff',
        subcommandGroup: subGroup,
        subcommand: sub,
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        ...(extra as object),
      });
      await staffCommand.execute(i as never, fx.container);
      expect(i.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    // --- /ticket remaining subcommands ---
    for (const [sub, extra] of [
      ['channels', { strings: { action: 'list' } }],
      ['categories', { strings: { action: 'list' } }],
      ['status', {}],
      ['stats', {}],
      ['staff', {}],
      ['report', { strings: { format: 'csv', period: 'WEEKLY' } }],
    ] as const) {
      const i = createMockCommandInteraction({
        commandName: 'ticket',
        subcommand: sub,
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        ...(extra as object),
      });
      await ticketCommand.execute(i as never, fx.container);
      expect(i.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    // Generate 3 separate reviews over time to exercise /review approve, /review later, /review reject, /review cancel, /review history
    await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: '2026-11-05T00:00:00.000Z',
    });
    const revA = fx.container.reviews.listGuildReviews(guildId, { pendingOnly: true })[0];

    for (const [sub, extra] of [
      ['later', { strings: { review_id: revA.review_id }, integers: { hours: 6 } }],
      ['approve', { strings: { review_id: revA.review_id, reason: 'Inactivity confirmed' } }],
      ['cancel', { strings: { review_id: revA.review_id, reason: 'Testing cancel flow' } }],
      ['history', {}],
    ] as const) {
      const i = createMockCommandInteraction({
        commandName: 'review',
        subcommand: sub,
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        ...(extra as object),
      });
      await reviewCommand.execute(i as never, fx.container);
      expect(i.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    await fx.container.scanner.scanGuildRoster(guildId, {
      trigger: 'MANUAL',
      actorUserId: ownerId,
      nowIso: '2026-11-06T00:00:00.000Z',
    });
    const revB = fx.container.reviews.listGuildReviews(guildId, { pendingOnly: true })[0];
    const rejectInt = createMockCommandInteraction({
      commandName: 'review',
      subcommand: 'reject',
      userId: ownerId,
      guildId,
      guildOwnerId: ownerId,
      strings: { review_id: revB.review_id, note: 'Rejected in command test' },
    });
    await reviewCommand.execute(rejectInt as never, fx.container);
    expect(rejectInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

    // --- /warning remaining subcommands (history, profile, appeal, remove, config) ---
    const issuedWarn = await fx.container.warnings.issueWarning({
      guildId,
      staffUserId: staffId,
      reason: 'Command test warning',
      issuedById: ownerId,
      approverId: ownerId,
      approverDisplayName: 'Owner',
    });

    const appealSubmitInt = createMockCommandInteraction({
      commandName: 'warning',
      subcommand: 'appeal',
      userId: staffId,
      guildId,
      guildOwnerId: ownerId,
      strings: { action: 'submit', target_id: issuedWarn.warning_id, reason: 'Internet outage explanation' },
    });
    await warningCommand.execute(appealSubmitInt as never, fx.container);
    expect(appealSubmitInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

    for (const [sub, extra] of [
      ['history', {}],
      ['profile', { users: { user: { id: staffId, username: 'staff_one' } } }],
      ['config', { integers: { expiry_days: 60 }, strings: { approval_policy: 'ANY_AUTHORIZED_REVIEWER' } }],
      ['remove', { strings: { warning_id: issuedWarn.warning_id, reason: 'Cleared during test' } }],
    ] as const) {
      const i = createMockCommandInteraction({
        commandName: 'warning',
        subcommand: sub,
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        ...(extra as object),
      });
      await warningCommand.execute(i as never, fx.container);
      expect(i.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }

    // --- /settings remaining subcommands (features, alerts, permissions, logs) ---
    for (const [sub, extra] of [
      ['features', { strings: { feature: 'daily_reports' }, booleans: { enabled: true } }],
      [
        'alerts',
        {
          channels: {
            alert_channel: { id: '860000000000000099', name: 'alerts', type: ChannelType.GuildText },
          },
        },
      ],
      ['permissions', { strings: { action: 'list' } }],
      ['logs', { integers: { limit: 10 } }],
    ] as const) {
      const i = createMockCommandInteraction({
        commandName: 'settings',
        subcommand: sub,
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        ...(extra as object),
      });
      await settingsCommand.execute(i as never, fx.container);
      expect(i.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    }
  });
});
