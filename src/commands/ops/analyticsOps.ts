import { assertLocal, brand, formatDuration, reply, statusIcon } from './shared';
import { CommandOperation } from './types';

export const ANALYTICS_OPERATIONS: CommandOperation[] = [
  {
    root: 'analytics',
    sub: 'overview',
    description: 'Show server analytics overview',
    options: [
      {
        kind: 'string',
        name: 'period',
        description: 'Report period',
        choices: [
          { name: 'Daily', value: 'DAILY' },
          { name: 'Weekly', value: 'WEEKLY' },
          { name: 'Monthly', value: 'MONTHLY' },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'ANALYTICS_OVERVIEW');
      const period = (interaction.options.getString('period', false) ?? 'WEEKLY') as 'DAILY' | 'WEEKLY' | 'MONTHLY';
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: period });
      await reply(
        interaction,
        brand(
          `📊 Analytics Overview — ${report.guildName}`,
          [
            `**Period:** ${report.fromIso.slice(0, 10)} → ${report.toIso.slice(0, 10)} (\`${report.periodType}\`)`,
            `**Coverage:** ${report.coverageLevel}`,
            `**Staff:** ${report.staffRows.length}`,
            report.staffRows.reduce((acc, s) => {
              acc[s.monitoringStatus] = (acc[s.monitoringStatus] ?? 0) + 1;
              return acc;
            }, {} as Record<string, number>)
              ? Object.entries(
                  report.staffRows.reduce<Record<string, number>>((acc, s) => {
                    acc[s.monitoringStatus] = (acc[s.monitoringStatus] ?? 0) + 1;
                    return acc;
                  }, {}),
                )
                  .map(([k, v]) => `${statusIcon(k)} ${k} ${v}`)
                  .join(' · ')
              : '',
            `**Tickets opened:** ${report.ticketMetrics.openedInPeriod}`,
            `**Tickets handled:** ${report.ticketMetrics.handledInPeriod}`,
            `**Resolved:** ${report.ticketMetrics.resolvedInPeriod}`,
            `**Avg first response:** ${formatDuration(report.ticketMetrics.avgFirstResponseSec)}`,
            `**Avg resolution:** ${formatDuration(report.ticketMetrics.avgResolutionSec)}`,
            `**Pending reviews:** ${report.reviewOutcomes.pending}`,
          ].join('\n'),
          'primary',
        ),
      );
    },
  },
  {
    root: 'analytics',
    sub: 'staff',
    description: 'Show fair staff performance analytics',
    options: [
      {
        kind: 'string',
        name: 'period',
        description: 'Report period',
        choices: [
          { name: 'Daily', value: 'DAILY' },
          { name: 'Weekly', value: 'WEEKLY' },
          { name: 'Monthly', value: 'MONTHLY' },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'ANALYTICS_STAFF');
      const period = (interaction.options.getString('period', false) ?? 'WEEKLY') as 'DAILY' | 'WEEKLY' | 'MONTHLY';
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: period });
      const rows = [...report.staffRows].sort((a, b) => b.ticketsHandled - a.ticketsHandled).slice(0, 20);
      await reply(
        interaction,
        brand(
          `📊 Staff Analytics (${rows.length})`,
          rows.length
            ? rows
                .map(
                  (s) =>
                    `${statusIcon(s.monitoringStatus)} **${s.displayName}** — handled ${s.ticketsHandled} · resolved ${s.ticketsResolved} · workload ${s.currentWorkload} · 30d events ${s.longTermActivity30d} · consistency ${s.workConsistencyPct}%\n  _${s.fairnessNote}_`,
                )
                .join('\n')
            : 'No staff analytics available.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'analytics',
    sub: 'tickets',
    description: 'Show ticket volume, response and resolution analytics',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'ANALYTICS_TICKETS');
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: 'WEEKLY' });
      const t = report.ticketMetrics;
      await reply(
        interaction,
        brand(
          '🎫 Ticket Analytics',
          [
            `**Opened in period:** ${t.openedInPeriod}`,
            `**Handled in period:** ${t.handledInPeriod}`,
            `**Resolved in period:** ${t.resolvedInPeriod}`,
            `**Reopened total:** ${t.reopenedTotal}`,
            `**Available workload:** ${t.availableWorkload}`,
            `**Avg first response:** ${formatDuration(t.avgFirstResponseSec)}`,
            `**Avg resolution:** ${formatDuration(t.avgResolutionSec)}`,
            '',
            'Staff are not ranked on ticket count alone; workload opportunity and monitoring coverage are considered.',
          ].join('\n'),
          'primary',
        ),
      );
    },
  },
  {
    root: 'analytics',
    sub: 'workload',
    description: 'Show workload distribution across active staff',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'ANALYTICS_WORKLOAD');
      const staff = container.roster.listStaffProfiles(access.guildId, { onlyActiveStaff: true });
      const total = staff.reduce((sum, s) => sum + s.current_workload, 0);
      await reply(
        interaction,
        brand(
          '⚖️ Workload Distribution',
          staff.length
            ? [
                `**Total active assignments:** ${total}`,
                '',
                ...staff
                  .sort((a, b) => b.current_workload - a.current_workload)
                  .slice(0, 25)
                  .map((s) => `• **${s.display_name}** — ${s.current_workload} active · ${s.tickets_handled_count} handled · ${s.tickets_resolved_count} resolved`),
              ].join('\n')
            : 'No active staff.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'analytics',
    sub: 'trends',
    description: 'Show daily monitoring and ticket trends',
    options: [{ kind: 'integer', name: 'days', description: 'Days of history (1-30)', minValue: 1, maxValue: 30 }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_ANALYTICS', 'ANALYTICS_TRENDS');
      const days = interaction.options.getInteger('days', false) ?? 14;
      const rows = container.db.all<{
        stat_date: string;
        active_staff: number;
        inactive_staff: number;
        tickets_opened: number;
        tickets_resolved: number;
        avg_first_response_sec: number | null;
      }>(
        `SELECT stat_date, active_staff, inactive_staff, tickets_opened, tickets_resolved, avg_first_response_sec
         FROM daily_statistics WHERE guild_id = ? ORDER BY stat_date DESC LIMIT ?`,
        [access.guildId, days],
      );
      await reply(
        interaction,
        brand(
          `📈 ${days}-Day Trends`,
          rows.length
            ? [
                ...rows
                  .reverse()
                  .map(
                    (r) =>
                      `• **${r.stat_date}** — 🟢 ${r.active_staff} active · 🔴 ${r.inactive_staff} inactive · 🎫 ${r.tickets_opened} opened · ✅ ${r.tickets_resolved} resolved · ⏱️ ${formatDuration(r.avg_first_response_sec)}`,
                  ),
                '',
                '_Trend rows are produced by scheduled scans; no values are fabricated._',
              ].join('\n')
            : 'No daily statistics recorded yet. Run `/scan now` or wait for the scheduler.',
          'primary',
        ),
      );
    },
  },
];
