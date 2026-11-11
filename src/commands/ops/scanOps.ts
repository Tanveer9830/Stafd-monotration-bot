import { MessageFlags } from 'discord.js';
import { collectLiveGuildTelemetry } from '../../utils/discordContext';
import { assertLocal, brand, reply, requireGuild, resolveAccess } from './shared';
import { CommandOperation } from './types';

export const SCAN_OPERATIONS: CommandOperation[] = [
  {
    root: 'scan',
    sub: 'now',
    description: 'Run a complete monitoring scan now (roster + tickets + health)',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'SCAN_NOW');
      const guild = requireGuild(interaction);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const startedAt = new Date().toISOString();
      const telemetry = await collectLiveGuildTelemetry(guild, container);
      const report = await container.scanner.scanGuildRoster(access.guildId, {
        trigger: 'MANUAL',
        actorUserId: access.userId,
        liveMembers: telemetry.liveMembers,
      });
      const diag = container.tickets.runDiagnostics(access.guildId, telemetry.livePermissionChecks, container.config.enableMessageContentIntent);
      const scanId = container.staffDiscovery.recordScan({
        guildId: access.guildId,
        scanType: 'FULL',
        trigger: 'MANUAL',
        actorUserId: access.userId,
        membersScanned: telemetry.liveMembers.length,
        staffDiscovered: report.totalStaffScanned,
        coverageLevel: diag.coverageLevel,
        startedAt,
        completedAt: new Date().toISOString(),
      });
      await interaction.editReply({
        embeds: [
          brand(
            '🛰️ Full Scan Complete',
            [
              `**Scan:** \`${scanId}\``,
              `**Members scanned:** ${telemetry.liveMembers.length}`,
              `**Staff examined:** ${report.totalStaffScanned}`,
              `**Ticket coverage:** ${diag.coverageLevel}`,
              `**Incidents updated:** ${report.incidentsCreatedOrUpdated}`,
              `**Reviews created:** ${report.reviewsCreated}`,
              `🟢 ${report.statusCounts.ACTIVE} · 🟡 ${report.statusCounts.AT_RISK} · 🔴 ${report.statusCounts.INACTIVE} · 🔵 ${report.statusCounts.ON_LEAVE} · 🆕 ${report.statusCounts.NEW_STAFF}`,
            ].join('\n'),
            'primary',
          ),
        ],
      });
    },
  },
  {
    root: 'scan',
    sub: 'staff',
    description: 'Rescan the staff roster and monitoring status',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'SCAN_STAFF');
      const guild = requireGuild(interaction);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const telemetry = await collectLiveGuildTelemetry(guild, container);
      const report = await container.scanner.scanGuildRoster(access.guildId, {
        trigger: 'MANUAL',
        actorUserId: access.userId,
        liveMembers: telemetry.liveMembers,
      });
      const scanId = container.staffDiscovery.recordScan({
        guildId: access.guildId,
        scanType: 'STAFF',
        trigger: 'MANUAL',
        actorUserId: access.userId,
        membersScanned: telemetry.liveMembers.length,
        staffDiscovered: report.totalStaffScanned,
        coverageLevel: report.coverageLevel,
      });
      await interaction.editReply({
        embeds: [
          brand('👥 Staff Scan Complete', `**Scan:** \`${scanId}\`\n**Staff examined:** ${report.totalStaffScanned}\n**Incidents updated:** ${report.incidentsCreatedOrUpdated}\n**Coverage:** ${report.coverageLevel}`, 'success'),
        ],
      });
    },
  },
  {
    root: 'scan',
    sub: 'tickets',
    description: 'Scan ticket coverage, permissions and claim state',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'SCAN_TICKETS');
      const guild = requireGuild(interaction);
      const telemetry = await collectLiveGuildTelemetry(guild, container);
      const diag = container.tickets.runDiagnostics(access.guildId, telemetry.livePermissionChecks, container.config.enableMessageContentIntent);
      const summary = container.tickets.getGuildTicketSummary(access.guildId);
      const pendingTimers = container.db.get<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM ticket_claim_timers WHERE guild_id = ? AND status = 'PENDING'",
        [access.guildId],
      );
      const scanId = container.staffDiscovery.recordScan({
        guildId: access.guildId,
        scanType: 'TICKETS',
        trigger: 'MANUAL',
        actorUserId: access.userId,
        coverageLevel: diag.coverageLevel,
      });
      await reply(
        interaction,
        brand(
          '🎫 Ticket Scan Complete',
          [
            `**Scan:** \`${scanId}\``,
            `**Coverage:** ${diag.coverageLevel} (${diag.accessibleCount} accessible / ${diag.inaccessibleCount} inaccessible)`,
            `**Tickets:** ${summary.totalTickets} total · ${summary.openTickets} open · ${summary.inProgressTickets} active`,
            `**Pending auto-claim timers:** ${pendingTimers?.cnt ?? 0}`,
            `**Adapters:** ${diag.adapterReports.map((a) => `${a.adapterId}: ${a.healthy ? 'healthy' : 'degraded'}`).join(', ')}`,
          ].join('\n'),
          diag.coverageLevel === 'FULL' ? 'success' : 'warning',
        ),
      );
    },
  },
  {
    root: 'scan',
    sub: 'history',
    description: 'Show recorded scan history for this server',
    options: [{ kind: 'integer', name: 'limit', description: 'Rows (1-25)', minValue: 1, maxValue: 25 }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'SCAN_HISTORY');
      const limit = interaction.options.getInteger('limit', false) ?? 10;
      const scans = container.staffDiscovery.listScanHistory(access.guildId, limit);
      await reply(
        interaction,
        brand(
          `🗄️ Scan History (${scans.length})`,
          scans.length
            ? scans
                .map(
                  (s) =>
                    `• \`${s.scan_id}\` **${s.scan_type}** / ${s.trigger_source} — ${s.completed_at}\n  members ${s.members_scanned} · staff ${s.staff_discovered} · new ${s.newly_registered} · coverage ${s.coverage_level}`,
                )
                .join('\n')
            : 'No scans recorded yet. Run `/scan now`.',
          'midnight',
        ),
      );
    },
  },
];
