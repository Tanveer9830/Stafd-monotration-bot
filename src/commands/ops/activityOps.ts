import { assertLocal, brand, formatDuration, reply, statusIcon, truncate } from './shared';
import { CommandOperation } from './types';

export const ACTIVITY_OPERATIONS: CommandOperation[] = [
  {
    root: 'activity',
    sub: 'overview',
    description: 'Show live staff activity health and status distribution',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'ACTIVITY_OVERVIEW');
      const staff = container.roster.listStaffProfiles(access.guildId, { onlyActiveStaff: true });
      const counts = staff.reduce<Record<string, number>>((acc, s) => {
        acc[s.monitoring_status] = (acc[s.monitoring_status] ?? 0) + 1;
        return acc;
      }, {});
      const last24 = container.db.get<{ cnt: number; users: number }>(
        `SELECT COUNT(*) AS cnt, COUNT(DISTINCT user_id) AS users FROM activity_events
         WHERE guild_id = ? AND is_qualifying = 1 AND occurred_at >= ?`,
        [access.guildId, new Date(Date.now() - 86_400_000).toISOString()],
      );
      await reply(
        interaction,
        brand(
          '⚡ Activity Overview',
          [
            `**Monitored staff:** ${staff.length}`,
            Object.entries(counts)
              .map(([status, count]) => `${statusIcon(status)} ${status}: **${count}**`)
              .join(' · ') || 'No staff registered.',
            '',
            `**Qualifying events (24h):** ${last24?.cnt ?? 0} across ${last24?.users ?? 0} staff member(s)`,
            `**Auto-claim delay:** ${container.settings.getNumber('ticket_auto_claim_minutes')} minutes`,
            `_Online presence is never treated as proof of work._`,
          ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'activity',
    sub: 'timeline',
    description: 'Show the live activity timeline across staff or one member',
    options: [
      { kind: 'user', name: 'user', description: 'Optional staff member filter' },
      { kind: 'integer', name: 'limit', description: 'Events (1-30)', minValue: 1, maxValue: 30 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'ACTIVITY_TIMELINE');
      const user = interaction.options.getUser('user', false);
      const limit = interaction.options.getInteger('limit', false) ?? 15;
      const events = container.db.all<{
        user_id: string;
        event_type: string;
        is_qualifying: number;
        occurred_at: string;
        classification_reason: string;
        ticket_id: string | null;
      }>(
        `SELECT user_id, event_type, is_qualifying, occurred_at, classification_reason, ticket_id
         FROM activity_events WHERE guild_id = ? ${user ? 'AND user_id = ?' : ''}
         ORDER BY occurred_at DESC LIMIT ?`,
        user ? [access.guildId, user.id, limit] : [access.guildId, limit],
      );
      await reply(
        interaction,
        brand(
          `🕒 Activity Timeline (${events.length})`,
          events.length
            ? events
                .map(
                  (e) =>
                    `• ${e.is_qualifying ? '🟢' : '⚪'} **${e.event_type}** — <@${e.user_id}> · ${e.occurred_at}${e.ticket_id ? ` · \`${e.ticket_id}\`` : ''}\n  ${truncate(e.classification_reason, 110)}`,
                )
                .join('\n')
            : 'No activity events recorded.',
          'primary',
        ),
      );
    },
  },
  {
    root: 'activity',
    sub: 'response-times',
    description: 'Show average response and resolution speeds across staff',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'ACTIVITY_RESPONSE_TIMES');
      const rows = container.db.all<{
        user_id: string;
        avg_first: number | null;
        avg_res: number | null;
        cnt: number;
      }>(
        `SELECT staff_user_id AS user_id,
                AVG(CASE WHEN event_type = 'FIRST_RESPONSE' THEN 1.0 END) AS avg_first,
                AVG(CASE WHEN event_type = 'RESOLVED' THEN 1.0 END) AS avg_res,
                COUNT(*) AS cnt
         FROM ticket_events
         WHERE guild_id = ? AND actor_user_id IS NOT NULL
         GROUP BY staff_user_id ORDER BY cnt DESC LIMIT 20`,
        [access.guildId],
      ).filter((r) => r.user_id);
      const profiles = container.roster.listStaffProfiles(access.guildId, { onlyActiveStaff: true });
      await reply(
        interaction,
        brand(
          '⏱️ Response & Resolution Speed',
          profiles.length
            ? profiles
                .sort((a, b) => (a.avg_first_response_sec ?? Infinity) - (b.avg_first_response_sec ?? Infinity))
                .slice(0, 20)
                .map(
                  (p) =>
                    `• **${p.display_name}** — first response ${formatDuration(p.avg_first_response_sec)} · resolution ${formatDuration(p.avg_resolution_sec)} · ${p.tickets_handled_count} handled`,
                )
                .join('\n')
            : 'No staff profiles yet.',
          'cyan',
        ),
      );
    },
  },
];
