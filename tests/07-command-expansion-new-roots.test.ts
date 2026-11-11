import { ChannelType } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activityCommand } from '../src/commands/activityCommand';
import { adminCommand } from '../src/commands/adminCommand';
import { analyticsCommand } from '../src/commands/analyticsCommand';
import { appealCommand } from '../src/commands/appealCommand';
import { backupCommand } from '../src/commands/backupCommand';
import { helpCommand } from '../src/commands/helpCommand';
import { integrationCommand } from '../src/commands/integrationCommand';
import { leaveCommand } from '../src/commands/leaveCommand';
import { logsCommand } from '../src/commands/logsCommand';
import { monitorCommand } from '../src/commands/monitorCommand';
import { notificationCommand } from '../src/commands/notificationCommand';
import { reportCommand } from '../src/commands/reportCommand';
import { scanCommand } from '../src/commands/scanCommand';
import { securityCommand } from '../src/commands/securityCommand';
import { serverCommand } from '../src/commands/serverCommand';
import { settingsCommand } from '../src/commands/settingsCommand';
import { systemCommand } from '../src/commands/systemCommand';
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

describe('Section 12: Command Expansion — All 23 Command Roots Functional', () => {
  let fx: RealDiskTestFixture;
  const guildId = '260000000000000001';
  const ownerId = '360000000000000001';
  const staffId = '660000000000000001';
  const globalOwnerId = GLOBAL_OWNER_ID;

  beforeEach(() => {
    fx = createRealSqliteTestFixture();
    fx.container.guildConfig.ensureGuildRegistered(guildId, 'Command Test Server', ownerId);
  });

  afterEach(() => {
    fx.cleanup();
  });

  // ============================================================
  // /admin — Global Owner only
  // ============================================================
  describe('/admin', () => {
    it('allows Global Owner to add, list, and remove bot administrators', async () => {
      fx.container.permissions.assertGlobalOwner(globalOwnerId, 'TEST_SETUP');

      // add
      const addInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'add',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
        users: { user: { id: '460000000000000001', username: 'bot_admin_1' } },
      });
      await adminCommand.execute(addInt as never, fx.container);
      expect(addInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

      // list
      const listInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'list',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
      });
      await adminCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

      // remove
      const removeInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'remove',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
        users: { user: { id: '460000000000000001', username: 'bot_admin_1' } },
      });
      await adminCommand.execute(removeInt as never, fx.container);
      expect(removeInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-Global-Owner from /admin with ACCESS DENIED', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'list',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(adminCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );

      // Verify audit log captured the unauthorized attempt
      const logs = fx.container.audit.listGuildLogs(guildId, {
        category: 'UNAUTHORIZED_ATTEMPT',
      });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('rejects a Bot Admin from appointing itself Global Owner', async () => {
      // Appoint a bot admin first (as Global Owner)
      fx.container.permissions.addBotAdmin(globalOwnerId, '460000000000000002', 'test_admin', [
        'VIEW_GLOBAL_STATS',
      ]);

      // Bot admin tries to use /admin
      const botAdminInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'add',
        userId: '460000000000000002',
        guildId,
        guildOwnerId: ownerId,
        users: { user: { id: '460000000000000003', username: 'rogue' } },
      });
      await expect(adminCommand.execute(botAdminInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /server — Server Owner or Global Owner
  // ============================================================
  describe('/server', () => {
    it('allows Server Owner to view server info and settings', async () => {
      const infoInt = createMockCommandInteraction({
        commandName: 'server',
        subcommand: 'info',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await serverCommand.execute(infoInt as never, fx.container);
      expect(infoInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

      const settingsInt = createMockCommandInteraction({
        commandName: 'server',
        subcommand: 'settings',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await serverCommand.execute(settingsInt as never, fx.container);
      expect(settingsInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('allows Global Owner to manage any server', async () => {
      const regInt = createMockCommandInteraction({
        commandName: 'server',
        subcommand: 'register',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
      });
      await serverCommand.execute(regInt as never, fx.container);
      expect(regInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner, non-Global-Owner from /server operations', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'server',
        subcommand: 'settings',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(serverCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );

      const logs = fx.container.audit.listGuildLogs(guildId, {
        category: 'UNAUTHORIZED_ATTEMPT',
      });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('prevents Guild A owner from accessing Guild B server settings', async () => {
      const guildB = '260000000000000002';
      const ownerB = '360000000000000002';
      fx.container.guildConfig.ensureGuildRegistered(guildB, 'Server B', ownerB);

      const crossInt = createMockCommandInteraction({
        commandName: 'server',
        subcommand: 'info',
        userId: ownerId,
        guildId: guildB,
        guildOwnerId: ownerB,
      });
      await expect(serverCommand.execute(crossInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /activity — Staff activity tracking
  // ============================================================
  describe('/activity', () => {
    it('lists staff activity events for authorized users', async () => {
      const listInt = createMockCommandInteraction({
        commandName: 'activity',
        subcommand: 'list',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        integers: { limit: 10 },
      });
      await activityCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('views staff activity profile', async () => {
      const profileInt = createMockCommandInteraction({
        commandName: 'activity',
        subcommand: 'profile',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        users: { user: { id: staffId, username: 'staff_one' } },
      });
      await activityCommand.execute(profileInt as never, fx.container);
      expect(profileInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('views activity statistics', async () => {
      const statsInt = createMockCommandInteraction({
        commandName: 'activity',
        subcommand: 'stats',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await activityCommand.execute(statsInt as never, fx.container);
      expect(statsInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });
  });

  // ============================================================
  // /monitor — Monitoring controls
  // ============================================================
  describe('/monitor', () => {
    it('shows monitoring status', async () => {
      const statusInt = createMockCommandInteraction({
        commandName: 'monitor',
        subcommand: 'status',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await monitorCommand.execute(statusInt as never, fx.container);
      expect(statusInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner from monitor config', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'monitor',
        subcommand: 'config',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        strings: { key: 'scan_interval_minutes', value: '30' },
      });
      await expect(monitorCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /scan — Manual and scheduled scans
  // ============================================================
  describe('/scan', () => {
    it('runs a manual scan', async () => {
      const runInt = createMockCommandInteraction({
        commandName: 'scan',
        subcommand: 'run',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { scope: 'full' },
      });
      await scanCommand.execute(runInt as never, fx.container);
      expect(runInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner from scan management', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'scan',
        subcommand: 'schedule',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        integers: { interval_minutes: 30 },
      });
      await expect(scanCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /integration — Ticket integrations
  // ============================================================
  describe('/integration', () => {
    it('lists integrations', async () => {
      const listInt = createMockCommandInteraction({
        commandName: 'integration',
        subcommand: 'list',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await integrationCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner from integration add/remove', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'integration',
        subcommand: 'add',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        strings: { type: 'discord_webhook' },
      });
      await expect(integrationCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /appeal — Warning appeals
  // ============================================================
  describe('/appeal', () => {
    it('allows staff to submit an appeal', async () => {
      const warn = await fx.container.warnings.issueWarning({
        guildId,
        staffUserId: staffId,
        reason: 'Appeal test warning',
        issuedById: ownerId,
        approverId: ownerId,
        approverDisplayName: 'Owner',
      });

      const submitInt = createMockCommandInteraction({
        commandName: 'appeal',
        subcommand: 'submit',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        strings: { warning_id: warn.warning_id, reason: 'False positive' },
      });
      await appealCommand.execute(submitInt as never, fx.container);
      expect(submitInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('lists appeals', async () => {
      const listInt = createMockCommandInteraction({
        commandName: 'appeal',
        subcommand: 'list',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await appealCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('allows reviewer to decide an appeal', async () => {
      const warn = await fx.container.warnings.issueWarning({
        guildId,
        staffUserId: staffId,
        reason: 'Appeal decide test',
        issuedById: ownerId,
        approverId: ownerId,
        approverDisplayName: 'Owner',
      });
      const appealRecord = await fx.container.warnings.submitAppeal({
        guildId,
        warningId: warn.warning_id,
        staffUserId: staffId,
        appealReason: 'Test appeal',
      });

      const decideInt = createMockCommandInteraction({
        commandName: 'appeal',
        subcommand: 'decide',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { appeal_id: appealRecord.appeal_id, decision: 'APPROVED', note: 'Accepted' },
      });
      await appealCommand.execute(decideInt as never, fx.container);
      expect(decideInt.getCaptured()?.embeds?.[0]!.toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });
  });

  // ============================================================
  // /leave — Staff leave management
  // ============================================================
  describe('/leave', () => {
    it('allows staff to submit leave', async () => {
      const submitInt = createMockCommandInteraction({
        commandName: 'leave',
        subcommand: 'submit',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        strings: { start_date: '2026-12-01', end_date: '2026-12-05', reason: 'Annual break' },
      });
      await leaveCommand.execute(submitInt as never, fx.container);
      expect(submitInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('allows manager to approve leave', async () => {
      const leave = await fx.container.leave.submitLeaveRequest({
        guildId,
        staffUserId: staffId,
        requestedById: staffId,
        reason: 'Break',
        startAt: '2026-12-01T00:00:00.000Z',
        endAt: '2026-12-05T23:59:59.999Z',
      });

      const approveInt = createMockCommandInteraction({
        commandName: 'leave',
        subcommand: 'approve',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { leave_id: leave.leave_id, note: 'Approved' },
      });
      await leaveCommand.execute(approveInt as never, fx.container);
      expect(approveInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('lists active leave requests', async () => {
      const listInt = createMockCommandInteraction({
        commandName: 'leave',
        subcommand: 'active',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await leaveCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0]!.toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });
  });

  // ============================================================
  // /analytics — Performance analytics
  // ============================================================
  describe('/analytics', () => {
    it('builds server analytics', async () => {
      const serverInt = createMockCommandInteraction({
        commandName: 'analytics',
        subcommand: 'server',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { period: 'WEEKLY' },
      });
      await analyticsCommand.execute(serverInt as never, fx.container);
      expect(serverInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('builds staff analytics', async () => {
      const staffInt = createMockCommandInteraction({
        commandName: 'analytics',
        subcommand: 'staff',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        users: { user: { id: staffId, username: 'staff_one' } },
        strings: { period: 'WEEKLY' },
      });
      await analyticsCommand.execute(staffInt as never, fx.container);
      expect(staffInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('exports analytics period report', async () => {
      const exportInt = createMockCommandInteraction({
        commandName: 'analytics',
        subcommand: 'export',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { period: 'WEEKLY', format: 'png' },
      });
      await analyticsCommand.execute(exportInt as never, fx.container);
      expect(exportInt.getCaptured()?.files).toHaveLength(1);
    });
  });

  // ============================================================
  // /report — Report generation
  // ============================================================
  describe('/report', () => {
    it('generates a PNG report', async () => {
      const genInt = createMockCommandInteraction({
        commandName: 'report',
        subcommand: 'generate',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { period: 'WEEKLY', format: 'png' },
      });
      await reportCommand.execute(genInt as never, fx.container);
      expect(genInt.getCaptured()?.files).toHaveLength(1);
    });

    it('lists report history', async () => {
      const listInt = createMockCommandInteraction({
        commandName: 'report',
        subcommand: 'list',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await reportCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('views scheduled reports', async () => {
      const schedInt = createMockCommandInteraction({
        commandName: 'report',
        subcommand: 'schedule',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await reportCommand.execute(schedInt as never, fx.container);
      expect(schedInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });
  });

  // ============================================================
  // /settings — Server configuration
  // ============================================================
  describe('/settings', () => {
    it('configures inactivity thresholds', async () => {
      const int = createMockCommandInteraction({
        commandName: 'settings',
        subcommand: 'inactivity',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        integers: { at_risk_hours: 20, inactive_hours: 40, escalation_hours: 60 },
      });
      await settingsCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('toggles features', async () => {
      const int = createMockCommandInteraction({
        commandName: 'settings',
        subcommand: 'features',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { feature: 'daily_reports' },
        booleans: { enabled: true },
      });
      await settingsCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner from settings', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'settings',
        subcommand: 'inactivity',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        integers: { at_risk_hours: 20 },
      });
      await expect(settingsCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /Access Denied|ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /security — Security and permissions
  // ============================================================
  describe('/security', () => {
    it('allows Global Owner to view global security policy', async () => {
      const int = createMockCommandInteraction({
        commandName: 'security',
        subcommand: 'policy',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
      });
      await securityCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('allows Server Owner to view permissions', async () => {
      const int = createMockCommandInteraction({
        commandName: 'security',
        subcommand: 'permissions',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await securityCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner from security policy', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'security',
        subcommand: 'policy',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(securityCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /logs — Audit logs
  // ============================================================
  describe('/logs', () => {
    it('views guild audit logs', async () => {
      const int = createMockCommandInteraction({
        commandName: 'logs',
        subcommand: 'view',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        integers: { limit: 10 },
      });
      await logsCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('searches audit logs by action type', async () => {
      const int = createMockCommandInteraction({
        commandName: 'logs',
        subcommand: 'search',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { action_type: 'WARNING_ISSUED' },
        integers: { limit: 10 },
      });
      await logsCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-owner from global logs', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'logs',
        subcommand: 'global',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        integers: { limit: 10 },
      });
      await expect(logsCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /backup — Database backup and recovery
  // ============================================================
  describe('/backup', () => {
    it('allows Global Owner to create, list, and verify backups', async () => {
      const createInt = createMockCommandInteraction({
        commandName: 'backup',
        subcommand: 'create',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
      });
      await backupCommand.execute(createInt as never, fx.container);
      expect(createInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);

      const listInt = createMockCommandInteraction({
        commandName: 'backup',
        subcommand: 'list',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
      });
      await backupCommand.execute(listInt as never, fx.container);
      expect(listInt.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('rejects non-Global-Owner from backup operations', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'backup',
        subcommand: 'create',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(backupCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /system — Bot health and diagnostics
  // ============================================================
  describe('/system', () => {
    it('shows system health', async () => {
      const int = createMockCommandInteraction({
        commandName: 'system',
        subcommand: 'health',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await systemCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('shows diagnostics', async () => {
      const int = createMockCommandInteraction({
        commandName: 'system',
        subcommand: 'diagnostics',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await systemCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('shows scheduler status', async () => {
      const int = createMockCommandInteraction({
        commandName: 'system',
        subcommand: 'scheduler',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await systemCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('restricts /system info to Global Owner only', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'system',
        subcommand: 'info',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(systemCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /notification — Notification management
  // ============================================================
  describe('/notification', () => {
    it('lists notification history', async () => {
      const int = createMockCommandInteraction({
        commandName: 'notification',
        subcommand: 'list',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await notificationCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('configures notification delivery', async () => {
      const int = createMockCommandInteraction({
        commandName: 'notification',
        subcommand: 'config',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { type: 'warning_dm', channel: 'DM' },
      });
      await notificationCommand.execute(int as never, fx.container);
      expect(int.getCaptured()?.embeds?.[0].toJSON().footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('restricts global inbox to Global Owner', async () => {
      const deniedInt = createMockCommandInteraction({
        commandName: 'notification',
        subcommand: 'global',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(notificationCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });

  // ============================================================
  // /help — Interactive command guide
  // ============================================================
  describe('/help', () => {
    it('shows command guide for all categories', async () => {
      const int = createMockCommandInteraction({
        commandName: 'help',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { category: 'all' },
      });
      await helpCommand.execute(int as never, fx.container);
      const embed = int.getCaptured()!.embeds![0]!.toJSON();
      expect(embed.title).toContain('TANVEER STAFF MONITOR');
      expect(embed.footer?.text).toBe(PERMANENT_EMBED_FOOTER);
    });

    it('shows specific category commands', async () => {
      const int = createMockCommandInteraction({
        commandName: 'help',
        userId: ownerId,
        guildId,
        guildOwnerId: ownerId,
        strings: { category: 'security' },
      });
      await helpCommand.execute(int as never, fx.container);
      const embed = int.getCaptured()!.embeds![0]!.toJSON();
      expect(embed.title).toContain('TANVEER STAFF MONITOR');
    });
  });

  // ============================================================
  // Cross-cutting security tests
  // ============================================================
  describe('Security enforcement across all new commands', () => {
    it('blocks Discord Administrator role holders from admin commands', async () => {
      // Even if staffId has Discord Administrator permission, they are not server owner
      const deniedInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'add',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
        users: { user: { id: '999999999999999999', username: 'x' } },
      });
      await expect(adminCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });

    it('blocks Co-Owner tier from administrative commands', async () => {
      // Grant Co-Owner to staffId
      fx.container.permissions.setGuildPermissionAssignment(
        { userId: ownerId, guildId, actualGuildOwnerId: ownerId },
        { targetType: 'USER', targetId: staffId, permissionLevel: 'CO_OWNER' },
      );

      const deniedInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'list',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(adminCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });

    it('records unauthorized attempts in audit logs', async () => {
      const beforeCount = fx.container.audit.listGuildLogs(guildId, {
        category: 'UNAUTHORIZED_ATTEMPT',
      }).length;

      try {
        await adminCommand.execute(
          createMockCommandInteraction({
            commandName: 'admin',
            subcommandGroup: 'admins',
            subcommand: 'list',
            userId: staffId,
            guildId,
            guildOwnerId: ownerId,
          }) as never,
          fx.container,
        );
      } catch {
        // expected
      }

      const afterCount = fx.container.audit.listGuildLogs(guildId, {
        category: 'UNAUTHORIZED_ATTEMPT',
      }).length;
      expect(afterCount).toBeGreaterThan(beforeCount);
    });

    it('permission checks still work after container reopen (simulates bot restart)', async () => {
      // Create some state
      fx.container.permissions.addBotAdmin(globalOwnerId, '460000000000000005', 'restart_test', [
        'VIEW_GLOBAL_STATS',
      ]);

      // Reopen container (simulates restart)
      fx.reopenContainer();

      // Global Owner still works after restart
      const allowedInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'list',
        userId: globalOwnerId,
        username: 'tanveer5637',
        guildId,
        guildOwnerId: ownerId,
      });
      await adminCommand.execute(allowedInt as never, fx.container);

      // Non-owner still blocked after restart
      const deniedInt = createMockCommandInteraction({
        commandName: 'admin',
        subcommandGroup: 'admins',
        subcommand: 'list',
        userId: staffId,
        guildId,
        guildOwnerId: ownerId,
      });
      await expect(adminCommand.execute(deniedInt as never, fx.container)).rejects.toThrow(
        /ACCESS_DENIED/,
      );
    });
  });
});
