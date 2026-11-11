import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const leaveCommand: SlashCommandModule = {
  name: 'leave',
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Staff leave management')
    .addSubcommand((sub) =>
      sub
        .setName('submit')
        .setDescription('Submit a leave request (for yourself or another staff member if authorized)')
        .addUserOption((opt) => opt.setName('staff').setDescription('Target staff member (defaults to you)'))
        .addStringOption((opt) =>
          opt.setName('start_date').setDescription('Start date (YYYY-MM-DD)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('end_date').setDescription('End date (YYYY-MM-DD)').setRequired(true),
        )
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason for leave').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('active').setDescription('View active and pending leave requests'),
    )
    .addSubcommand((sub) =>
      sub.setName('history').setDescription('View historical leave records'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('Approve a leave request (leave managers only)')
        .addStringOption((opt) =>
          opt.setName('leave_id').setDescription('Leave ID (LVE-...)').setRequired(true),
        )
        .addStringOption((opt) => opt.setName('note').setDescription('Decision note').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reject')
        .setDescription('Reject a leave request (leave managers only)')
        .addStringOption((opt) =>
          opt.setName('leave_id').setDescription('Leave ID (LVE-...)').setRequired(true),
        )
        .addStringOption((opt) => opt.setName('note').setDescription('Decision note').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel a leave request (leave managers only)')
        .addStringOption((opt) =>
          opt.setName('leave_id').setDescription('Leave ID (LVE-...)').setRequired(true),
        )
        .addStringOption((opt) => opt.setName('reason').setDescription('Cancellation reason').setRequired(false)),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Leave commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'submit') {
      // Any staff member can submit leave for themselves; managers can submit for others
      const staffUser = interaction.options.getUser('staff', false);
      const targetStaffId = staffUser?.id ?? ctx.userId;
      const startDate = interaction.options.getString('start_date', true).trim();
      const endDate = interaction.options.getString('end_date', true).trim();
      const reason = interaction.options.getString('reason', true).trim();

      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (targetStaffId !== ctx.userId && !perms.canManageLeave) {
        assertAuthorizedOrDenied({
          actorUserId: ctx.userId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/leave submit (for another staff member)',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }

      const created = container.leave.submitLeaveRequest({
        guildId: ctx.guildId,
        staffUserId: targetStaffId,
        requestedById: ctx.userId,
        reason,
        startAt: startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`,
        endAt: endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`,
        autoApproveById: perms.canManageLeave ? ctx.userId : null,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Leave Record Created — \`${created.leave_id}\``,
        tone: 'success',
        subtitle: interaction.guild.name,
        description:
          `Staff: <@${created.staff_user_id}> | Status: **\`${created.status}\`**\n` +
          `Window: **${created.start_at.slice(0, 10)} → ${created.end_at.slice(0, 10)}**`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.canViewReports && !perms.isGlobalOwner && !perms.isServerOwner) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/leave ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'active') {
      const list = container.leave.listGuildLeave(ctx.guildId, { activeOnly: true, limit: 30 });
      const embed = createBrandEmbed({
        title: `${emojis.get('active')} Active & Pending Staff Leave (${list.length})`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          list.length === 0
            ? 'No active or pending leave records.'
            : list
                .map(
                  (l) =>
                    `• \`${l.leave_id}\` — <@${l.staff_user_id}> [\`${l.status}\`]\n  ${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)} | ${l.reason}`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'history') {
      const list = container.leave.listGuildLeave(ctx.guildId, { activeOnly: false, limit: 30 });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Historical Staff Leave (${list.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          list.length === 0
            ? 'No historical leave records.'
            : list
                .map(
                  (l) =>
                    `• \`${l.leave_id}\` — <@${l.staff_user_id}> [\`${l.status}\`]\n  ${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)} | ${l.reason}`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // approve, reject, cancel require canManageLeave
    if (!perms.canManageLeave && !perms.isGlobalOwner && !perms.isServerOwner) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/leave ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    const leaveId = interaction.options.getString('leave_id', true).trim();
    const note = interaction.options.getString('note', false) ?? interaction.options.getString('reason', false) ?? '';

    if (sub === 'approve') {
      const updated = container.leave.approveLeave(ctx.guildId, leaveId, ctx.userId, note);
      const embed = createBrandEmbed({
        title: `${emojis.get('approval')} Leave Approved — \`${updated.leave_id}\``,
        tone: 'success',
        description: `Approved leave for <@${updated.staff_user_id}> (Status: \`${updated.status}\`).`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reject') {
      const updated = container.leave.rejectLeave(ctx.guildId, leaveId, ctx.userId, note);
      const embed = createBrandEmbed({
        title: `${emojis.get('rejection')} Leave Request Rejected — \`${updated.leave_id}\``,
        tone: 'neutral',
        description: `Rejected leave request for <@${updated.staff_user_id}>.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'cancel') {
      const updated = container.leave.cancelLeave(ctx.guildId, leaveId, ctx.userId, note);
      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Leave Cancelled — \`${updated.leave_id}\``,
        tone: 'warning',
        description: `Cancelled leave \`${leaveId}\` for <@${updated.staff_user_id}>. Normal monitoring resumes.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
