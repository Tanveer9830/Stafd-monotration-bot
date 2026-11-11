import { ChannelType } from 'discord.js';
import { TicketRecord, TicketStatus } from '../../types/domain';
import { assertLocal, brand, formatDuration, reply, truncate } from './shared';
import { CommandOperation } from './types';

function resolveTicket(
  container: Parameters<CommandOperation['handler']>[0]['container'],
  guildId: string,
  value: string,
): TicketRecord {
  const raw = value.trim().replace(/^#/, '').replace(/[<#>]/g, '');
  const direct = container.tickets.getTicketById(guildId, raw);
  if (direct) return direct;
  const byNumber = container.db.get<TicketRecord>(
    `SELECT * FROM ticket_records WHERE guild_id = ? AND (ticket_number = ? OR external_ticket_ref = ?)
     ORDER BY opened_at DESC LIMIT 1`,
    [guildId, raw, raw],
  );
  if (byNumber) return byNumber;
  const byChannel = container.db.get<TicketRecord>(
    `SELECT * FROM ticket_records WHERE guild_id = ? AND channel_id = ? ORDER BY opened_at DESC LIMIT 1`,
    [guildId, raw],
  );
  if (byChannel) return byChannel;
  throw new Error(`No ticket matches "${value}" in this server. Search by ticket number, ticket ID or channel ID.`);
}

function requireTicketManage(actorAccess: { localScopes: Set<string> }, container: Parameters<CommandOperation['handler']>[0]['container'], guildId: string, userId: string, action: string): void {
  if (!actorAccess.localScopes.has('SERVER_MANAGE_TICKETS')) {
    container.audit.log({
      guildId,
      actorUserId: userId,
      actionCategory: 'UNAUTHORIZED_ATTEMPT',
      actionType: 'TICKET_MANAGE_DENIED',
      metadata: { action },
    });
    throw new Error('Access Denied: you need the SERVER_MANAGE_TICKETS permission.');
  }
}

const TICKET_CHANNEL_TYPES = [ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildForum];

export const TICKET_OPERATIONS: CommandOperation[] = [
  {
    root: 'ticket',
    sub: 'setup',
    description: 'Configure a ticket category or channel for monitoring',
    options: [
      { kind: 'channel', name: 'target', description: 'Ticket category or channel', required: true, channelTypes: TICKET_CHANNEL_TYPES },
      {
        kind: 'string',
        name: 'adapter',
        description: 'Ticket integration adapter',
        choices: [
          { name: 'Generic Discord tickets', value: 'generic' },
          { name: 'Ticket Tool', value: 'ticket-tool' },
          { name: 'Tickets v2', value: 'tickets-v2' },
          { name: 'Custom pattern', value: 'custom' },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_TICKETS', 'TICKET_SETUP');
      const target = interaction.options.getChannel('target', true);
      const adapter = interaction.options.getString('adapter', false) ?? 'generic';
      const targetType = target.type === ChannelType.GuildCategory ? 'CATEGORY' : 'CHANNEL';
      const { record, adapterWarning } = container.tickets.addTicketChannelConfig(access.guildId, access.userId, {
        targetType,
        channelId: target.id,
        channelName: target.name ?? target.id,
        adapterType: adapter,
      });
      await reply(
        interaction,
        brand(
          '🎫 Ticket Monitoring Configured',
          [
            `**Target:** ${record.target_type} \`${record.channel_name}\` (\`${record.channel_id}\`)`,
            `**Adapter:** \`${record.adapter_type}\``,
            `**Coverage:** ingest begins for observable messages and lifecycle events.`,
            adapterWarning ? `\n⚠️ ${adapterWarning}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          'success',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'channels',
    description: 'List, add or remove monitored ticket channels',
    options: [
      {
        kind: 'string',
        name: 'action',
        description: 'Channel action',
        required: true,
        choices: [
          { name: 'List', value: 'list' },
          { name: 'Add channel', value: 'add' },
          { name: 'Remove channel', value: 'remove' },
        ],
      },
      { kind: 'channel', name: 'channel', description: 'Ticket channel', channelTypes: [ChannelType.GuildText, ChannelType.GuildForum] },
      { kind: 'string', name: 'adapter', description: 'Adapter type', choices: [
        { name: 'Generic', value: 'generic' },
        { name: 'Ticket Tool', value: 'ticket-tool' },
        { name: 'Tickets v2', value: 'tickets-v2' },
      ] },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_CHANNELS');
      const action = interaction.options.getString('action', true);
      if (action === 'list') {
        const list = container.tickets.listTicketChannelConfigs(access.guildId).filter((c) => c.target_type !== 'CATEGORY');
        await reply(
          interaction,
          brand(
            `🎫 Monitored Ticket Channels (${list.length})`,
            list.length ? list.map((c) => `• <#${c.channel_id}> (\`${c.channel_id}\`) — \`${c.adapter_type}\``).join('\n') : 'No ticket channels configured.',
            'cyan',
          ),
        );
        return;
      }
      container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'TICKET_CHANNELS_MODIFY');
      const channel = interaction.options.getChannel('channel', true);
      if (action === 'add') {
        const result = container.tickets.addTicketChannelConfig(access.guildId, access.userId, {
          targetType: 'CHANNEL',
          channelId: channel.id,
          channelName: channel.name ?? channel.id,
          adapterType: interaction.options.getString('adapter', false) ?? 'generic',
        });
        await reply(interaction, brand('✅ Ticket Channel Added', `Monitoring <#${result.record.channel_id}>.`, 'success'));
      } else {
        const removed = container.tickets.removeTicketChannelConfig(access.guildId, access.userId, channel.id);
        await reply(
          interaction,
          brand(removed ? '✅ Ticket Channel Removed' : '⚠️ Not Configured', removed ? `Removed <#${channel.id}>.` : 'That channel was not configured.', removed ? 'success' : 'warning'),
        );
      }
    },
  },
  {
    root: 'ticket',
    sub: 'categories',
    description: 'List, add or remove monitored ticket categories',
    options: [
      {
        kind: 'string',
        name: 'action',
        description: 'Category action',
        required: true,
        choices: [
          { name: 'List', value: 'list' },
          { name: 'Add category', value: 'add' },
          { name: 'Remove category', value: 'remove' },
        ],
      },
      { kind: 'channel', name: 'category', description: 'Discord category', channelTypes: [ChannelType.GuildCategory] },
      { kind: 'string', name: 'adapter', description: 'Adapter type', choices: [
        { name: 'Generic', value: 'generic' },
        { name: 'Ticket Tool', value: 'ticket-tool' },
        { name: 'Tickets v2', value: 'tickets-v2' },
      ] },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_CATEGORIES');
      const action = interaction.options.getString('action', true);
      if (action === 'list') {
        const list = container.tickets.listTicketChannelConfigs(access.guildId).filter((c) => c.target_type === 'CATEGORY');
        await reply(
          interaction,
          brand(
            `🎫 Monitored Ticket Categories (${list.length})`,
            list.length ? list.map((c) => `• **${c.channel_name}** (\`${c.channel_id}\`) — \`${c.adapter_type}\``).join('\n') : 'No ticket categories configured.',
            'cyan',
          ),
        );
        return;
      }
      container.authz.assertLocalScope(access, 'SERVER_MANAGE_TICKETS', 'TICKET_CATEGORIES_MODIFY');
      const category = interaction.options.getChannel('category', true);
      if (action === 'add') {
        const result = container.tickets.addTicketChannelConfig(access.guildId, access.userId, {
          targetType: 'CATEGORY',
          channelId: category.id,
          channelName: category.name ?? category.id,
          adapterType: interaction.options.getString('adapter', false) ?? 'generic',
        });
        await reply(interaction, brand('✅ Ticket Category Added', `Monitoring category **${result.record.channel_name}**.`, 'success'));
      } else {
        const removed = container.tickets.removeTicketChannelConfig(access.guildId, access.userId, category.id);
        await reply(
          interaction,
          brand(removed ? '✅ Ticket Category Removed' : '⚠️ Not Configured', removed ? `Removed category \`${category.id}\`.` : 'That category was not configured.', removed ? 'success' : 'warning'),
        );
      }
    },
  },
  {
    root: 'ticket',
    sub: 'search',
    description: 'Search real tickets by ticket number, channel ID or ticket ID',
    options: [
      { kind: 'string', name: 'query', description: 'Ticket number or channel ID', required: true },
      { kind: 'integer', name: 'limit', description: 'Results (1-25)', minValue: 1, maxValue: 25 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_SEARCH');
      const query = interaction.options.getString('query', true);
      const limit = interaction.options.getInteger('limit', false) ?? 10;
      const result = container.tickets.listTickets(access.guildId, { search: query, pageSize: limit });
      await reply(
        interaction,
        brand(
          `🔎 Ticket Search — "${query}" (${result.total})`,
          result.items.length
            ? result.items
                .map(
                  (t) =>
                    `• **#${t.ticket_number ?? t.ticket_id}** \`${t.ticket_id}\` — ${t.status}${t.claim_type === 'AUTOMATIC' ? ' 🤖 auto-claimed' : t.claim_type === 'MANUAL' ? ' ✋ manual claim' : ''}\n  <#${t.channel_id}> · opener ${t.opener_user_id ? `<@${t.opener_user_id}>` : 'unknown'} · assignee ${t.assigned_to_user_id ? `<@${t.assigned_to_user_id}>` : 'unclaimed'} · ${t.opened_at}`,
                )
                .join('\n')
            : 'No tickets matched. Ticket numbers come from real captured ticket data only.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'view',
    description: 'Open a ticket with captured conversation and event timeline',
    options: [{ kind: 'string', name: 'ticket', description: 'Ticket number, ticket ID or channel ID', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_VIEW');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const detail = container.tickets.getTicketDetail(access.guildId, ticket.ticket_id)!;
      const lines = [
        `**Ticket:** \`${ticket.ticket_id}\` · #${ticket.ticket_number ?? '—'}`,
        `**Channel:** <#${ticket.channel_id}>`,
        `**Status:** ${ticket.status} · **Claim:** ${ticket.claim_type ?? 'NONE'}`,
        `**Creator:** ${ticket.opener_user_id ? `<@${ticket.opener_user_id}>` : 'unknown'}`,
        `**Assigned:** ${ticket.assigned_to_user_id ? `<@${ticket.assigned_to_user_id}>` : 'unclaimed'}`,
        `**First responder:** ${ticket.first_response_staff_id ? `<@${ticket.first_response_staff_id}>` : '—'} at ${ticket.first_staff_response_at ?? '—'}`,
        `**Claim time:** ${ticket.claim_at ?? '—'}`,
        `**First response:** ${formatDuration(ticket.first_response_sec)} · **Resolution:** ${formatDuration(ticket.resolution_sec)}`,
        `**Messages captured:** ${detail.messages.length} · **Events:** ${detail.events.length}`,
      ];
      if (access.localScopes.has('SERVER_VIEW_TRANSCRIPTS')) {
        const transcript = detail.messages
          .slice(-8)
          .map((m) => `• [${m.author_type}] **${m.author_name}** ${m.sent_at}: ${m.content_available ? truncate(m.content ?? '', 180) : '_content not captured (Message Content intent disabled)_'}`)
          .join('\n');
        lines.push('', '**Recent conversation:**', transcript || '_No messages captured yet._');
        container.audit.log({
          guildId: access.guildId,
          actorUserId: access.userId,
          actionCategory: 'TICKET',
          actionType: 'TICKET_TRANSCRIPT_ACCESSED',
          targetType: 'TICKET',
          targetId: ticket.ticket_id,
          metadata: { surface: 'discord_command' },
        });
      } else {
        lines.push('', '_Conversation transcript requires SERVER_VIEW_TRANSCRIPTS._');
      }
      await reply(interaction, brand(`🎫 Ticket #${ticket.ticket_number ?? ticket.ticket_id}`, lines.join('\n'), 'primary'));
    },
  },
  {
    root: 'ticket',
    sub: 'status',
    description: 'Show the live ticket queue status',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_STATUS');
      const summary = container.tickets.getGuildTicketSummary(access.guildId);
      const unclaimed = container.tickets.listTickets(access.guildId, { claim: 'UNCLAIMED', pageSize: 5 });
      const auto = container.db.get<{ cnt: number }>(
        "SELECT COUNT(*) AS cnt FROM ticket_records WHERE guild_id = ? AND claim_type = 'AUTOMATIC'",
        [access.guildId],
      );
      await reply(
        interaction,
        brand(
          '🎫 Live Ticket Queue',
          [
            `**Total:** ${summary.totalTickets}`,
            `**Open:** ${summary.openTickets} · **Active:** ${summary.inProgressTickets} · **Resolved:** ${summary.resolvedTickets} · **Closed:** ${summary.closedTickets}`,
            `**Reopened count:** ${summary.reopenedTickets}`,
            `**Unclaimed:** ${unclaimed.total} · **Automatic claims:** ${auto?.cnt ?? 0}`,
            `**Avg first response:** ${formatDuration(summary.avgFirstResponseSec)}`,
            `**Avg resolution:** ${formatDuration(summary.avgResolutionSec)}`,
            unclaimed.items.length ? `\n**Oldest unclaimed:**\n${unclaimed.items.map((t) => `• #${t.ticket_number ?? t.ticket_id} — <#${t.channel_id}>`).join('\n')}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'claim',
    description: 'Manually claim a ticket (cancels any pending automatic claim)',
    options: [{ kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_CLAIM');
      if (!access.isActiveStaff) {
        throw new Error('Only registered active staff members can claim tickets. Ask a manager to assign instead.');
      }
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const result = container.tickets.claimTicket({
        guildId: access.guildId,
        ticketId: ticket.ticket_id,
        staffUserId: access.userId,
        claimType: 'MANUAL',
      });
      await reply(
        interaction,
        brand(
          '✋ Ticket Manually Claimed',
          `Ticket **#${result.ticket.ticket_number ?? result.ticket.ticket_id}** is now assigned to <@${access.userId}>.\nAny pending automatic claim timer was cancelled. Send a meaningful reply to count as work.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'unclaim',
    description: 'Release a ticket assignment',
    options: [{ kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_UNCLAIM');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      if (ticket.claimed_by_user_id !== access.userId) {
        requireTicketManage(access, container, access.guildId, access.userId, 'TICKET_UNCLAIM');
      }
      const now = new Date().toISOString();
      container.db.transaction(() => {
        container.db.run(
          `UPDATE ticket_records SET claimed_by_user_id = NULL, assigned_to_user_id = NULL,
             claim_type = NULL, claim_at = NULL, status = CASE WHEN status = 'CLAIMED' THEN 'OPEN' ELSE status END,
             updated_at = ? WHERE guild_id = ? AND ticket_id = ?`,
          [now, access.guildId, ticket.ticket_id],
        );
        container.db.run(
          `UPDATE ticket_assignments SET is_current = 0, unassigned_at = ? WHERE guild_id = ? AND ticket_id = ? AND is_current = 1`,
          [now, access.guildId, ticket.ticket_id],
        );
        container.db.run(
          `INSERT INTO ticket_events (ticket_id, guild_id, actor_user_id, event_type, details_json, occurred_at)
           VALUES (?, ?, ?, 'OWNERSHIP_CHANGED', ?, ?)`,
          [ticket.ticket_id, access.guildId, access.userId, JSON.stringify({ action: 'UNCLAIMED', previousClaimedBy: ticket.claimed_by_user_id }), now],
        );
      });
      await reply(interaction, brand('↩️ Ticket Unclaimed', `Ticket **#${ticket.ticket_number ?? ticket.ticket_id}** is unassigned again.`, 'warning'));
    },
  },
  {
    root: 'ticket',
    sub: 'assign',
    description: 'Assign a ticket to a staff member',
    options: [
      { kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true },
      { kind: 'user', name: 'staff', description: 'Staff member', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_ASSIGN');
      requireTicketManage(access, container, access.guildId, access.userId, 'TICKET_ASSIGN');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const staff = interaction.options.getUser('staff', true);
      if (!container.roster.isActiveStaffMember(access.guildId, staff.id)) {
        throw new Error(`<@${staff.id}> is not an active monitored staff member.`);
      }
      const result = container.tickets.assignOrReassignTicket({
        guildId: access.guildId,
        ticketId: ticket.ticket_id,
        staffUserId: staff.id,
        actorUserId: access.userId,
      });
      await reply(
        interaction,
        brand('✅ Ticket Assigned', `Ticket **#${result.ticket.ticket_number ?? result.ticket.ticket_id}** assigned to <@${staff.id}>.`, 'success'),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'reassign',
    description: 'Reassign a ticket from its current staff member to another',
    options: [
      { kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true },
      { kind: 'user', name: 'staff', description: 'New assignee', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_REASSIGN');
      requireTicketManage(access, container, access.guildId, access.userId, 'TICKET_REASSIGN');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const staff = interaction.options.getUser('staff', true);
      if (!container.roster.isActiveStaffMember(access.guildId, staff.id)) {
        throw new Error(`<@${staff.id}> is not an active monitored staff member.`);
      }
      const result = container.tickets.assignOrReassignTicket({
        guildId: access.guildId,
        ticketId: ticket.ticket_id,
        staffUserId: staff.id,
        actorUserId: access.userId,
      });
      await reply(
        interaction,
        brand(
          '🔁 Ticket Reassigned',
          `Ticket **#${result.ticket.ticket_number ?? result.ticket.ticket_id}** reassigned from ${ticket.assigned_to_user_id ? `<@${ticket.assigned_to_user_id}>` : 'unassigned'} to <@${staff.id}>.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'staff',
    description: 'Show ticket workload and speed for one staff member or the team',
    options: [{ kind: 'user', name: 'user', description: 'Optional staff member' }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_STAFF');
      const user = interaction.options.getUser('user', false);
      const profiles = user
        ? [container.roster.getStaffProfile(access.guildId, user.id)].filter((p): p is NonNullable<typeof p> => Boolean(p))
        : container.roster
            .listStaffProfiles(access.guildId, { onlyActiveStaff: true })
            .sort((a, b) => b.tickets_handled_count - a.tickets_handled_count)
            .slice(0, 20);
      await reply(
        interaction,
        brand(
          `🎫 Ticket Staff Metrics (${profiles.length})`,
          profiles.length
            ? profiles
                .map(
                  (p) =>
                    `• **${p.display_name}** — workload ${p.current_workload} · handled ${p.tickets_handled_count} · resolved ${p.tickets_resolved_count} · first response ${formatDuration(p.avg_first_response_sec)}`,
                )
                .join('\n')
            : 'No matching staff profiles.',
          'primary',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'history',
    description: 'Show recent ticket lifecycle events across the server',
    options: [{ kind: 'integer', name: 'limit', description: 'Events (1-30)', minValue: 1, maxValue: 30 }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_HISTORY');
      const limit = interaction.options.getInteger('limit', false) ?? 15;
      const events = container.db.all<{ ticket_id: string; event_type: string; actor_user_id: string | null; occurred_at: string; details_json: string }>(
        `SELECT ticket_id, event_type, actor_user_id, occurred_at, details_json FROM ticket_events
         WHERE guild_id = ? ORDER BY occurred_at DESC LIMIT ?`,
        [access.guildId, limit],
      );
      await reply(
        interaction,
        brand(
          `🗄️ Recent Ticket History (${events.length})`,
          events.length
            ? events
                .map((e) => `• **${e.event_type}** \`${e.ticket_id}\`${e.actor_user_id ? ` by \`${e.actor_user_id}\`` : ''} — ${e.occurred_at}`)
                .join('\n')
            : 'No ticket events captured yet.',
          'midnight',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'timeline',
    description: 'Show the chronological event timeline for one ticket',
    options: [{ kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_TIMELINE');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const events = container.tickets.listTicketEvents(access.guildId, ticket.ticket_id, 60);
      await reply(
        interaction,
        brand(
          `🕒 Ticket #${ticket.ticket_number ?? ticket.ticket_id} Timeline`,
          events.length
            ? events
                .map((e) => {
                  let extra = '';
                  try {
                    const details = JSON.parse(e.details_json) as Record<string, unknown>;
                    if (details.claimType) extra = ` (${String(details.claimType)})`;
                    else if (details.action) extra = ` (${String(details.action)})`;
                  } catch {
                    extra = '';
                  }
                  return `• \`${e.event_type}\`${extra}${e.actor_user_id ? ` — <@${e.actor_user_id}>` : ''} · ${e.occurred_at}`;
                })
                .join('\n')
            : 'No events captured for this ticket.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'stats',
    description: 'Show server ticket statistics',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_STATS');
      const summary = container.tickets.getGuildTicketSummary(access.guildId);
      const claimTypes = container.db.all<{ claim_type: string; cnt: number }>(
        `SELECT COALESCE(claim_type,'NONE') AS claim_type, COUNT(*) AS cnt FROM ticket_records
         WHERE guild_id = ? GROUP BY COALESCE(claim_type,'NONE')`,
        [access.guildId],
      );
      await reply(
        interaction,
        brand(
          '📊 Ticket Statistics',
          [
            `**Total:** ${summary.totalTickets}`,
            `**Open / Active:** ${summary.openTickets} / ${summary.inProgressTickets}`,
            `**Resolved / Closed:** ${summary.resolvedTickets} / ${summary.closedTickets}`,
            `**Reopened:** ${summary.reopenedTickets}`,
            `**Avg first response:** ${formatDuration(summary.avgFirstResponseSec)}`,
            `**Avg resolution:** ${formatDuration(summary.avgResolutionSec)}`,
            '',
            `**Claim types:** ${claimTypes.map((c) => `${c.claim_type} ${c.cnt}`).join(' · ') || 'none'}`,
          ].join('\n'),
          'primary',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'response-times',
    description: 'Show first-response time statistics per staff member',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_RESPONSE_TIMES');
      const rows = container.db.all<{ first_response_staff_id: string; cnt: number; avg_sec: number | null; min_sec: number | null }>(
        `SELECT first_response_staff_id, COUNT(*) AS cnt, AVG(first_response_sec) AS avg_sec, MIN(first_response_sec) AS min_sec
         FROM ticket_records WHERE guild_id = ? AND first_response_staff_id IS NOT NULL
         GROUP BY first_response_staff_id ORDER BY avg_sec ASC LIMIT 20`,
        [access.guildId],
      );
      await reply(
        interaction,
        brand(
          `⏱️ First Response Times (${rows.length})`,
          rows.length
            ? rows.map((r) => `• <@${r.first_response_staff_id}> — avg **${formatDuration(r.avg_sec)}** · best ${formatDuration(r.min_sec)} · ${r.cnt} ticket(s)`).join('\n')
            : 'No first-response data captured yet.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'resolution-times',
    description: 'Show resolution time statistics per staff member',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'TICKET_RESOLUTION_TIMES');
      const rows = container.db.all<{ resolved_by_user_id: string; cnt: number; avg_sec: number | null }>(
        `SELECT resolved_by_user_id, COUNT(*) AS cnt, AVG(resolution_sec) AS avg_sec
         FROM ticket_records WHERE guild_id = ? AND resolved_by_user_id IS NOT NULL AND resolution_sec IS NOT NULL
         GROUP BY resolved_by_user_id ORDER BY avg_sec ASC LIMIT 20`,
        [access.guildId],
      );
      await reply(
        interaction,
        brand(
          `⏳ Resolution Times (${rows.length})`,
          rows.length
            ? rows.map((r) => `• <@${r.resolved_by_user_id}> — avg **${formatDuration(r.avg_sec)}** · ${r.cnt} resolved`).join('\n')
            : 'No resolution-time data captured yet.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'reopen',
    description: 'Reopen a resolved or closed ticket',
    options: [{ kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_TICKETS', 'TICKET_REOPEN');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const result = container.tickets.reopenTicket({
        guildId: access.guildId,
        ticketId: ticket.ticket_id,
        actorUserId: access.userId,
      });
      await reply(
        interaction,
        brand('🔓 Ticket Reopened', `Ticket **#${result.ticket.ticket_number ?? result.ticket.ticket_id}** reopened. Reopened count: ${result.ticket.reopened_count}.`, 'warning'),
      );
    },
  },
  {
    root: 'ticket',
    sub: 'close',
    description: 'Close a ticket',
    options: [
      { kind: 'string', name: 'ticket', description: 'Ticket number, ID or channel ID', required: true },
      { kind: 'string', name: 'reason', description: 'Optional closure reason' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_TICKETS', 'TICKET_CLOSE');
      const ticket = resolveTicket(container, access.guildId, interaction.options.getString('ticket', true));
      const reason = interaction.options.getString('reason', false);
      const result = container.tickets.closeTicket({
        guildId: access.guildId,
        ticketId: ticket.ticket_id,
        actorUserId: access.userId,
      });
      await reply(
        interaction,
        brand(
          '🔒 Ticket Closed',
          `Ticket **#${result.ticket.ticket_number ?? result.ticket.ticket_id}** closed.${reason ? `\n**Reason:** ${reason}` : ''}\nAny pending automatic claim timer was cancelled.`,
          'success',
        ),
      );
    },
  },
];

export { resolveTicket };
