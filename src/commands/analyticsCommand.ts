import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { formatSecondsCompact } from '../utils/ids';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';
import { ReportPeriodType } from '../services/AnalyticsService';

export const analyticsCommand: SlashCommandModule = {
  name: 'analytics',
  data: new SlashCommandBuilder()
    .setName('analytics')
    .setDescription('Performance analytics and metrics')
    .addSubcommand((sub) =>
      sub.setName('server').setDescription('View server-wide performance analytics'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('staff')
        .setDescription('View analytics for a specific staff member')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('period')
        .setDescription('View analytics for a custom time period')
        .addStringOption((opt) =>
          opt
            .setName('period')
            .setDescription('Report time window')
            .setRequired(true)
            .addChoices(
              { name: 'Daily (24h)', value: 'DAILY' },
              { name: 'Weekly (7d)', value: 'WEEKLY' },
              { name: 'Monthly (30d)', value: 'MONTHLY' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('export').setDescription('Export analytics as PNG/CSV/PDF'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Analytics commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.canViewReports && !perms.isGlobalOwner && !perms.isServerOwner) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/analytics ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'server') {
      const report = container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: 'WEEKLY' });
      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Fairness-Adjusted Server Analytics (7-Day)`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Staff are evaluated using workload availability, consistency, and verified monitoring coverage — never raw ticket count alone.`,
      }).addFields(
        {
          name: 'Ticket Flow (7d)',
          value: `Opened: **${report.ticketMetrics.openedInPeriod}** | Handled: **${report.ticketMetrics.handledInPeriod}** | Resolved: **${report.ticketMetrics.resolvedInPeriod}**`,
          inline: false,
        },
        {
          name: 'Top Staff',
          value:
            report.staffRows.length === 0
              ? 'No staff data yet.'
              : report.staffRows
                  .slice(0, 5)
                  .map(
                    (r) =>
                      `• **${r.username}** — Consistency: **${r.workConsistencyPct}%** | Handled: **${r.ticketsHandled}** | *${r.fairnessNote}*`,
                  )
                  .join('\n'),
          inline: false,
        },
        { name: 'Coverage', value: report.coverageLevel, inline: true },
        { name: 'Active Warnings', value: `${report.warningMetrics.level1Active + report.warningMetrics.level2Active + report.warningMetrics.level3Active}`, inline: true },
        { name: 'Pending Reviews', value: `${report.reviewOutcomes.pending}`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'staff') {
      const targetUser = interaction.options.getUser('user', true);
      const report = container.analytics.buildGuildAnalytics(ctx.guildId, {
        periodType: 'WEEKLY',
        targetStaffUserId: targetUser.id,
      });
      const row = report.staffRows[0];
      const embed = createBrandEmbed({
        title: `${emojis.get('performance')} Staff Analytics — ${targetUser.username}`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Status', value: row ? row.monitoringStatus : 'NO DATA', inline: true },
        { name: 'Tickets Handled', value: row ? `${row.ticketsHandled}` : '0', inline: true },
        { name: 'Tickets Resolved', value: row ? `${row.ticketsResolved}` : '0', inline: true },
        { name: 'Avg First Response', value: row ? formatSecondsCompact(row.firstResponseSec) : 'N/A', inline: true },
        { name: 'Avg Resolution', value: row ? formatSecondsCompact(row.avgResolutionSec) : 'N/A', inline: true },
        { name: 'Work Consistency', value: row ? `${row.workConsistencyPct}%` : '0%', inline: true },
        { name: 'Active Warnings', value: row ? `${row.activeWarnings}` : '0', inline: true },
        { name: 'Fairness Note', value: row ? row.fairnessNote : 'No data available', inline: false },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'period') {
      const period = interaction.options.getString('period', true) as ReportPeriodType;
      const report = container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: period });
      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} ${period} Period Analytics`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Window: **${report.fromIso.slice(0, 10)} → ${report.toIso.slice(0, 10)}**`,
      }).addFields(
        {
          name: 'Ticket Flow',
          value: `Opened: **${report.ticketMetrics.openedInPeriod}** | Handled: **${report.ticketMetrics.handledInPeriod}** | Resolved: **${report.ticketMetrics.resolvedInPeriod}**`,
          inline: false,
        },
        {
          name: 'Warnings Issued',
          value: `Level 1: **${report.warningMetrics.level1Active}** | Level 2: **${report.warningMetrics.level2Active}** | Level 3: **${report.warningMetrics.level3Active}**`,
          inline: true,
        },
        { name: 'Reviews Pending', value: `${report.reviewOutcomes.pending}`, inline: true },
        { name: 'Reviews Approved', value: `${report.reviewOutcomes.approved}`, inline: true },
        { name: 'Coverage', value: report.coverageLevel, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'export') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const report = container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: 'WEEKLY' });
      const { AttachmentBuilder } = require('discord.js');

      // CSV export
      const csvLines = [
        'user_id,username,display_name,category,status,tickets_assigned,tickets_handled,tickets_resolved,current_workload,work_consistency_pct,active_warnings',
      ];
      for (const r of report.staffRows) {
        csvLines.push(
          `${r.userId},"${r.username}","${r.displayName}","${r.primaryCategory}","${r.monitoringStatus}",${r.ticketsAssigned},${r.ticketsHandled},${r.ticketsResolved},${r.currentWorkload},${r.workConsistencyPct},${r.activeWarnings}`,
        );
      }
      const csvContent = csvLines.join('\n');
      const file = new AttachmentBuilder(Buffer.from(csvContent, 'utf8'), {
        name: `tanveer-analytics-${ctx.guildId}-${report.fromIso.slice(0, 10)}.csv`,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Analytics Export (CSV)`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Exported analytics for **${report.staffRows.length}** staff members.`,
      });
      await interaction.editReply({ embeds: [embed], files: [file] });
      return;
    }
  },
};
