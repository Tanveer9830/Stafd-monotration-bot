import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { formatWarningLevelLabel } from '../services/WarningService';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { SlashCommandModule } from './types';

export const reviewCommand: SlashCommandModule = {
  name: 'review',
  data: new SlashCommandBuilder()
    .setName('review')
    .setDescription('Human-controlled inactivity warning review & approval workflow')
    .addSubcommand((sub) => sub.setName('pending').setDescription('List all pending warning review requests'))
    .addSubcommand((sub) => sub.setName('history').setDescription('View completed & cancelled warning review history'))
    .addSubcommand((sub) =>
      sub
        .setName('approve')
        .setDescription('Initiate warning approval (runs live safety rechecks & displays final confirmation)')
        .addStringOption((opt) => opt.setName('review_id').setDescription('Review ID (REV-...)').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Optional custom warning reason'))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional management note')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reject')
        .setDescription('Reject an inactivity warning review request')
        .addStringOption((opt) => opt.setName('review_id').setDescription('Review ID (REV-...)').setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('Reason for rejection')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('later')
        .setDescription('Defer a warning review request for later inspection')
        .addStringOption((opt) => opt.setName('review_id').setDescription('Review ID (REV-...)').setRequired(true))
        .addIntegerOption((opt) => opt.setName('hours').setDescription('Hours to defer (default 12)'))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional deferral note')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('cancel')
        .setDescription('Cancel an open warning review request')
        .addStringOption((opt) => opt.setName('review_id').setDescription('Review ID (REV-...)').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Cancellation reason').setRequired(true)),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Review commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'pending') {
      container.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'REVIEW_PENDING');
      const list = container.reviews.listGuildReviews(ctx.guildId, { pendingOnly: true, limit: 20 });
      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Pending Warning Reviews (${list.length})`,
        tone: 'warning',
        subtitle: interaction.guild.name,
        description:
          list.length === 0
            ? 'No pending warning reviews in this server.'
            : list
                .map(
                  (r) =>
                    `• **\`${r.review_id}\`** — Staff <@${r.staff_user_id}> (\`${r.staff_user_id}\`)\n` +
                    `  Status: \`${r.status}\` | Policy: \`${r.required_policy}\` | Suggested: **${formatWarningLevelLabel(r.suggested_level)}**`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'history') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'REVIEW_HISTORY');
      const list = container.reviews.listGuildReviews(ctx.guildId, { pendingOnly: false, limit: 20 });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Warning Review History (${list.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          list.length === 0
            ? 'No warning reviews recorded yet.'
            : list
                .map(
                  (r) =>
                    `• \`${r.review_id}\` — <@${r.staff_user_id}> | [\`${r.status}\`]${r.final_actor_id ? ` by \`${r.final_actor_id}\`` : ''}` +
                    (r.final_note ? ` — *${r.final_note}*` : ''),
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'approve') {
      const reviewId = interaction.options.getString('review_id', true).trim();
      const reason = interaction.options.getString('reason', false) ?? undefined;
      const note = interaction.options.getString('note', false) ?? undefined;

      const res = await container.reviews.initiateWarningApproval(ctx, reviewId, {
        proposedReason: reason,
        proposedNote: note,
        actorDisplayName: interaction.user.username,
      });

      if (res.stage === 'AWAITING_FINAL_CONFIRMATION') {
        const embed = createBrandEmbed({
          title: `${emojis.get('warning')} Final Confirmation Required — \`${reviewId}\``,
          tone: 'danger',
          subtitle: interaction.guild.name,
          description:
            `${res.message}\n\n` +
            `**Target Staff:** <@${res.review.staff_user_id}> (\`${res.review.staff_user_id}\`)\n` +
            `**Proposed Level:** ${formatWarningLevelLabel(res.review.suggested_level)}\n` +
            `**Proposed Reason:** ${res.review.proposed_reason}\n` +
            (res.review.proposed_note ? `**Management Note:** ${res.review.proposed_note}\n` : ''),
        });
        await interaction.reply({
          embeds: [embed],
          components: [container.reviews.buildFinalConfirmationButtons(reviewId)],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const embed = createBrandEmbed({
        title:
          res.stage === 'AUTO_CANCELLED'
            ? `${emojis.get('active')} Review Auto-Cancelled`
            : `${emojis.get('approval')} First Approval Recorded`,
        tone: res.stage === 'AUTO_CANCELLED' ? 'success' : 'warning',
        subtitle: interaction.guild.name,
        description: res.message,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'reject') {
      const reviewId = interaction.options.getString('review_id', true).trim();
      const note = interaction.options.getString('note', false) ?? undefined;
      const updated = container.reviews.rejectReview(ctx, reviewId, interaction.user.username, note);
      const embed = createBrandEmbed({
        title: `${emojis.get('rejection')} Review Rejected — \`${updated.review_id}\``,
        tone: 'neutral',
        description: `Rejected warning review for <@${updated.staff_user_id}>. No warning was issued.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'later') {
      const reviewId = interaction.options.getString('review_id', true).trim();
      const hours = interaction.options.getInteger('hours', false) ?? 12;
      const note = interaction.options.getString('note', false) ?? undefined;
      const updated = container.reviews.deferReviewLater(ctx, reviewId, hours, note);
      const embed = createBrandEmbed({
        title: `${emojis.get('loading')} Review Deferred — \`${updated.review_id}\``,
        tone: 'cyan',
        description: `Deferred review for <@${updated.staff_user_id}> until **${updated.deferred_until}**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'cancel') {
      const reviewId = interaction.options.getString('review_id', true).trim();
      const reason = interaction.options.getString('reason', true);
      const cancelled = await container.reviews.cancelReviewByCommand(ctx, reviewId, reason);
      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Review Cancelled — \`${cancelled.review_id}\``,
        tone: 'success',
        description: `Cancelled warning review for <@${cancelled.staff_user_id}>.\nReason: *${reason}*`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
