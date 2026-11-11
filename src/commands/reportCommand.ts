import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';
import { ReportPeriodType } from '../services/AnalyticsService';

export const reportCommand: SlashCommandModule = {
  name: 'report',
  data: new SlashCommandBuilder()
    .setName('report')
    .setDescription('Report generation and export')
    .addSubcommand((sub) =>
      sub
        .setName('generate')
        .setDescription('Generate a branded performance report')
        .addStringOption((opt) =>
          opt
            .setName('period')
            .setDescription('Report time window')
            .setRequired(true)
            .addChoices(
              { name: 'Daily (24h)', value: 'DAILY' },
              { name: 'Weekly (7d)', value: 'WEEKLY' },
              { name: 'Monthly (30d)', value: 'MONTHLY' },
              { name: 'Custom Date Range', value: 'CUSTOM' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('format')
            .setDescription('Export file format')
            .setRequired(false)
            .addChoices(
              { name: 'PNG Visual Report', value: 'png' },
              { name: 'CSV Data Export', value: 'csv' },
              { name: 'PDF Executive Report', value: 'pdf' },
            ),
        )
        .addStringOption((opt) => opt.setName('from_date').setDescription('Start date for CUSTOM (YYYY-MM-DD)'))
        .addStringOption((opt) => opt.setName('to_date').setDescription('End date for CUSTOM (YYYY-MM-DD)')),
    )
    .addSubcommand((sub) =>
      sub.setName('schedule').setDescription('View or manage scheduled reports'),
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List recent reports generated for this server'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Report commands must be executed inside a Discord server.');
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
        actionDescription: `/report ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'generate') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const period = (interaction.options.getString('period', false) as ReportPeriodType | null) ?? 'WEEKLY';
      const fmt = (interaction.options.getString('format', false) ?? 'png') as 'png' | 'csv' | 'pdf';
      const fromDate = interaction.options.getString('from_date', false) ?? undefined;
      const toDate = interaction.options.getString('to_date', false) ?? undefined;

      const report = container.analytics.buildGuildAnalytics(ctx.guildId, {
        periodType: period,
        customFromIso: fromDate,
        customToIso: toDate,
      });

      const files: AttachmentBuilder[] = [];
      if (fmt === 'png') {
        const buf = container.reportExporter.exportGuildPngReport(report);
        files.push(new AttachmentBuilder(buf, { name: `tanveer-report-${period.toLowerCase()}.png` }));
      } else if (fmt === 'csv') {
        const buf = container.reportExporter.exportGuildCsvReport(report);
        files.push(new AttachmentBuilder(buf, { name: `tanveer-report-${period.toLowerCase()}.csv` }));
      } else {
        const buf = await container.reportExporter.exportGuildPdfReport(report);
        files.push(new AttachmentBuilder(buf, { name: `tanveer-report-${period.toLowerCase()}.pdf` }));
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} ${period} Performance Report Generated`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Exported verified database metrics in **${fmt.toUpperCase()}** format (${report.fromIso.slice(0, 10)} → ${report.toIso.slice(0, 10)}).`,
      });
      await interaction.editReply({ embeds: [embed], files });
      return;
    }

    if (sub === 'schedule') {
      const schedules = container.db.all<{
        schedule_id: string;
        report_type: string;
        format: string;
        cron_expression: string;
        is_active: number;
        next_run_at: string | null;
      }>(
        `SELECT * FROM report_schedules WHERE guild_id = ? ORDER BY created_at DESC`,
        [ctx.guildId],
      );
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Scheduled Reports (${schedules.length})`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          schedules.length === 0
            ? 'No scheduled reports configured.'
            : schedules
                .map(
                  (s) =>
                    `• \`${s.schedule_id}\` — ${s.report_type} (${s.format}) | Cron: \`${s.cron_expression}\` | ${s.is_active ? '🟢 Active' : '🔴 Inactive'} | Next: ${s.next_run_at ?? 'Pending'}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'list') {
      const logs = container.audit.listGuildLogs(ctx.guildId, {
        category: 'REPORT',
        limit: 20,
      });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Report Generation History (${logs.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          logs.length === 0
            ? 'No reports generated yet.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.action_type}\` by <@${l.actor_user_id}> at ${l.created_at.slice(11, 19)} UTC`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
