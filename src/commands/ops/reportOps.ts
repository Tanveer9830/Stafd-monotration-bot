import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { assertLocal, brand, formatDuration, parseDateOption, reply } from './shared';
import { CommandOperation } from './types';

function buildSummary(title: string, report: ReturnType<Parameters<CommandOperation['handler']>[0]['container']['analytics']['buildGuildAnalytics']>) {
  return brand(
    title,
    [
      `**Server:** ${report.guildName}`,
      `**Period:** ${report.fromIso.slice(0, 10)} → ${report.toIso.slice(0, 10)} (\`${report.periodType}\`)`,
      `**Staff:** ${report.staffRows.length}`,
      `**Tickets opened:** ${report.ticketMetrics.openedInPeriod} · **handled:** ${report.ticketMetrics.handledInPeriod} · **resolved:** ${report.ticketMetrics.resolvedInPeriod}`,
      `**Avg first response:** ${formatDuration(report.ticketMetrics.avgFirstResponseSec)}`,
      `**Avg resolution:** ${formatDuration(report.ticketMetrics.avgResolutionSec)}`,
      `**Warnings issued in period:** ${report.warningMetrics.issuedInPeriod}`,
      `**Reviews:** ${report.reviewOutcomes.pending} pending · ${report.reviewOutcomes.approved} approved`,
      '',
      '_Use `/report export` to download PNG, CSV or PDF._',
    ].join('\n'),
    'primary',
  );
}

export const REPORT_OPERATIONS: CommandOperation[] = [
  {
    root: 'report',
    sub: 'daily',
    description: 'Generate today’s analytics report',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'REPORT_DAILY');
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: 'DAILY' });
      await reply(interaction, buildSummary('📅 Daily Report', report));
    },
  },
  {
    root: 'report',
    sub: 'weekly',
    description: 'Generate a weekly analytics report',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'REPORT_WEEKLY');
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: 'WEEKLY' });
      await reply(interaction, buildSummary('🗓️ Weekly Report', report));
    },
  },
  {
    root: 'report',
    sub: 'custom',
    description: 'Generate a report for a custom date range',
    options: [
      { kind: 'string', name: 'from', description: 'Start date YYYY-MM-DD', required: true },
      { kind: 'string', name: 'to', description: 'End date YYYY-MM-DD', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'REPORT_CUSTOM');
      const fromIso = parseDateOption(interaction.options.getString('from', true));
      const toIso = parseDateOption(interaction.options.getString('to', true), true);
      if (!fromIso || !toIso) throw new Error('Dates must use YYYY-MM-DD format.');
      const report = container.analytics.buildGuildAnalytics(access.guildId, {
        periodType: 'CUSTOM',
        customFromIso: fromIso,
        customToIso: toIso,
      });
      await reply(interaction, buildSummary('📆 Custom Range Report', report));
    },
  },
  {
    root: 'report',
    sub: 'export',
    description: 'Export a branded report file',
    options: [
      {
        kind: 'string',
        name: 'format',
        description: 'File format',
        required: true,
        choices: [
          { name: 'CSV', value: 'csv' },
          { name: 'PNG', value: 'png' },
          { name: 'PDF', value: 'pdf' },
        ],
      },
      {
        kind: 'string',
        name: 'period',
        description: 'Reporting period',
        choices: [
          { name: 'Daily', value: 'DAILY' },
          { name: 'Weekly', value: 'WEEKLY' },
          { name: 'Monthly', value: 'MONTHLY' },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_EXPORT_REPORTS', 'REPORT_EXPORT');
      const format = interaction.options.getString('format', true);
      const period = (interaction.options.getString('period', false) ?? 'WEEKLY') as 'DAILY' | 'WEEKLY' | 'MONTHLY';
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: period });
      const files: AttachmentBuilder[] = [];
      if (format === 'csv') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGuildCsvReport(report), { name: 'tanveer-report.csv' }));
      } else if (format === 'png') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGuildPngReport(report), { name: 'tanveer-report.png' }));
      } else {
        files.push(new AttachmentBuilder(await container.reportExporter.exportGuildPdfReport(report), { name: 'tanveer-report.pdf' }));
      }
      await interaction.reply({
        embeds: [brand('📤 Report Exported', `Format **${format.toUpperCase()}** · period **${period}** · ${report.staffRows.length} staff rows.`, 'success')],
        files,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
];
