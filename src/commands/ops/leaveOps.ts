import { assertLocal, brand, formatHours, parseDateOption, reply, resolveAccess, truncate } from './shared';
import { CommandOperation } from './types';

export const LEAVE_OPERATIONS: CommandOperation[] = [
  {
    root: 'leave',
    sub: 'request',
    description: 'Request approved leave (leave pauses inactivity calculations)',
    options: [
      { kind: 'string', name: 'start_date', description: 'Start date YYYY-MM-DD', required: true },
      { kind: 'string', name: 'end_date', description: 'End date YYYY-MM-DD', required: true },
      { kind: 'string', name: 'reason', description: 'Reason for leave', required: true },
      { kind: 'user', name: 'staff', description: 'Staff member (managers only)' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await resolveAccess(interaction, container);
      const target = interaction.options.getUser('staff', false);
      let staffId = access.userId;
      if (target) {
        if (!access.localScopes.has('SERVER_MANAGE_LEAVE')) {
          throw new Error('Only leave managers can request leave on behalf of another member.');
        }
        staffId = target.id;
      }
      if (!container.roster.getStaffProfile(access.guildId, staffId)) {
        throw new Error('The selected member has no staff profile in this server.');
      }
      const startAt = parseDateOption(interaction.options.getString('start_date', true));
      const endAt = parseDateOption(interaction.options.getString('end_date', true), true);
      if (!startAt || !endAt) throw new Error('Dates must use YYYY-MM-DD format.');
      const leave = container.leave.submitLeaveRequest({
        guildId: access.guildId,
        staffUserId: staffId,
        requestedById: access.userId,
        reason: interaction.options.getString('reason', true),
        startAt,
        endAt,
      });
      await reply(
        interaction,
        brand(
          '📝 Leave Requested',
          `**Leave:** \`${leave.leave_id}\`\n**Staff:** <@${leave.staff_user_id}>\n**Period:** ${leave.start_at.slice(0, 10)} → ${leave.end_at.slice(0, 10)}\n**Status:** ${leave.status}\nA leave manager must approve this request.`,
          'cyan',
        ),
      );
    },
  },
  {
    root: 'leave',
    sub: 'approve',
    description: 'Approve a pending leave request',
    options: [
      { kind: 'string', name: 'leave_id', description: 'Leave ID', required: true },
      { kind: 'string', name: 'note', description: 'Decision note' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_LEAVE', 'LEAVE_APPROVE');
      const updated = container.leave.approveLeave(
        access.guildId,
        interaction.options.getString('leave_id', true),
        access.userId,
        interaction.options.getString('note', false) ?? undefined,
      );
      await reply(
        interaction,
        brand('✅ Leave Approved', `Leave \`${updated.leave_id}\` for <@${updated.staff_user_id}> is now **${updated.status}**. Inactivity monitoring is paused for the approved period.`, 'success'),
      );
    },
  },
  {
    root: 'leave',
    sub: 'reject',
    description: 'Reject a pending leave request',
    options: [
      { kind: 'string', name: 'leave_id', description: 'Leave ID', required: true },
      { kind: 'string', name: 'reason', description: 'Rejection reason', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_LEAVE', 'LEAVE_REJECT');
      const updated = container.leave.rejectLeave(
        access.guildId,
        interaction.options.getString('leave_id', true),
        access.userId,
        interaction.options.getString('reason', true),
      );
      await reply(interaction, brand('✖️ Leave Rejected', `Leave \`${updated.leave_id}\` for <@${updated.staff_user_id}> was rejected.`, 'warning'));
    },
  },
  {
    root: 'leave',
    sub: 'active',
    description: 'List currently active and upcoming approved leave',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'LEAVE_ACTIVE');
      const list = container.leave.listGuildLeave(access.guildId, { activeOnly: true, limit: 30 });
      await reply(
        interaction,
        brand(
          `🏖️ Active & Upcoming Leave (${list.length})`,
          list.length
            ? list
                .map(
                  (l) =>
                    `• \`${l.leave_id}\` — <@${l.staff_user_id}> · ${l.status} · ${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)}${l.reason ? ` · ${truncate(l.reason, 60)}` : ''}`,
                )
                .join('\n')
            : 'No active or upcoming leave.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'leave',
    sub: 'history',
    description: 'Show leave history for the server or one member',
    options: [
      { kind: 'user', name: 'user', description: 'Optional staff member' },
      { kind: 'integer', name: 'limit', description: 'Rows (1-25)', minValue: 1, maxValue: 25 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'LEAVE_HISTORY');
      const user = interaction.options.getUser('user', false);
      const limit = interaction.options.getInteger('limit', false) ?? 15;
      const list = container.leave.listGuildLeave(access.guildId, { staffUserId: user?.id, limit });
      await reply(
        interaction,
        brand(
          `🗄️ Leave History (${list.length})`,
          list.length
            ? list
                .map(
                  (l) =>
                    `• \`${l.leave_id}\` — <@${l.staff_user_id}> · ${l.status} · ${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)} · approved by ${l.approved_by_id ?? '—'}`,
                )
                .join('\n')
            : 'No leave records.',
          'midnight',
        ),
      );
    },
  },
];
