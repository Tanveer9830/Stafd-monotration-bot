import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const appealCommand: SlashCommandModule = {
  name: 'appeal',
  data: new SlashCommandBuilder()
    .setName('appeal')
    .setDescription('Warning appeal management')
    .addSubcommand((sub) =>
      sub
        .setName('submit')
        .setDescription('Submit an appeal for a warning')
        .addStringOption((opt) =>
          opt.setName('warning_id').setDescription('Warning ID (WRN-...)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Your appeal explanation').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List pending warning appeals (reviewers only)')
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Max appeals to show (1-50)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('decide')
        .setDescription('Approve or reject a pending appeal (reviewers only)')
        .addStringOption((opt) =>
          opt.setName('appeal_id').setDescription('Appeal ID (APL-...)').setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('decision')
            .setDescription('Decision')
            .setRequired(true)
            .addChoices(
              { name: 'Approve & Overturn Warning', value: 'approve' },
              { name: 'Reject Appeal', value: 'reject' },
            ),
        )
        .addStringOption((opt) => opt.setName('note').setDescription('Decision note').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub.setName('history').setDescription('View appeal history for this server'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Appeal commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'submit') {
      // Any staff member can submit an appeal for their own warning
      const warningId = interaction.options.getString('warning_id', true).trim();
      const reason = interaction.options.getString('reason', true).trim();

      if (reason.length < 5) {
        throw new Error('Appeal explanation must be at least 5 characters.');
      }

      // Find the warning globally to verify ownership
      const warning = container.warnings.findWarningGlobally(warningId);
      if (!warning) {
        throw new Error(`Warning \`${warningId}\` not found.`);
      }
      if (warning.guild_id !== ctx.guildId) {
        throw new Error('Cross-server appeal blocked by guild isolation policy.');
      }
      if (warning.staff_user_id !== ctx.userId && !container.permissions.isGlobalOwner(ctx.userId)) {
        throw new Error('Only the warned staff member can submit an appeal for this warning.');
      }
      if (warning.status !== 'ACTIVE') {
        throw new Error(`Cannot appeal a warning with status "${warning.status}".`);
      }

      const appeal = container.warnings.submitAppeal({
        guildId: ctx.guildId,
        warningId,
        staffUserId: ctx.userId,
        appealReason: reason,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Warning Appeal Submitted — \`${appeal.appeal_id}\``,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description: `Your appeal for warning \`${warningId}\` has been submitted for management review.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // list, decide, history require reviewer permissions
    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.canApproveWarnings && !perms.isGlobalOwner && !perms.isServerOwner) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/appeal ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'list') {
      const limit = Math.min(Math.max(interaction.options.getInteger('limit', false) ?? 20, 1), 50);
      const appeals = container.warnings.listAppeals(ctx.guildId, 'PENDING', limit);
      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Pending Warning Appeals (${appeals.length})`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          appeals.length === 0
            ? 'No pending appeals.'
            : appeals
                .map(
                  (a) =>
                    `• \`${a.appeal_id}\` (Warning \`${a.warning_id}\`) — Staff <@${a.staff_user_id}>\n  Reason: *${a.appeal_reason}*`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'decide') {
      const appealId = interaction.options.getString('appeal_id', true).trim();
      const decision = interaction.options.getString('decision', true) as 'approve' | 'reject';
      const note = interaction.options.getString('note', false) ?? '';

      const decided = container.warnings.decideAppeal({
        guildId: ctx.guildId,
        appealId,
        actorUserId: ctx.userId,
        actorDisplayName: interaction.user.username,
        decision: decision === 'approve' ? 'APPROVED' : 'REJECTED',
        decisionNote: note,
      });

      const embed = createBrandEmbed({
        title:
          decided.status === 'APPROVED'
            ? `${emojis.get('approval')} Appeal Approved & Warning Overturned`
            : `${emojis.get('rejection')} Appeal Rejected`,
        tone: decided.status === 'APPROVED' ? 'success' : 'neutral',
        description: `Appeal \`${decided.appeal_id}\` for warning \`${decided.warning_id}\` marked **${decided.status}**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'history') {
      const appeals = container.warnings.listAppeals(ctx.guildId, undefined, 30);
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Appeal History (${appeals.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          appeals.length === 0
            ? 'No appeals recorded yet.'
            : appeals
                .map(
                  (a) =>
                    `• \`${a.appeal_id}\` (Warning \`${a.warning_id}\`) — <@${a.staff_user_id}> | [\`${a.status}\`]${a.decided_by_id ? ` by <@${a.decided_by_id}>` : ''}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
