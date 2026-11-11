import { buildActorGuildContextFromDiscord } from '../../utils/discordContext';
import { formatWarningLevelLabel } from '../../services/WarningService';
import { assertLocal, brand, reply, requireGuild, truncate } from './shared';
import { CommandOperation } from './types';

function actorCtx(interaction: Parameters<CommandOperation['handler']>[0]['interaction'], guild: ReturnType<typeof requireGuild>, container: Parameters<CommandOperation['handler']>[0]['container']) {
  return buildActorGuildContextFromDiscord(interaction.user, guild, interaction.member as never, container);
}

export const REVIEW_OPERATIONS: CommandOperation[] = [
  {
    root: 'review',
    sub: 'pending',
    description: 'List pending inactivity warning reviews',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_REVIEWS', 'REVIEW_PENDING');
      const list = container.reviews.listGuildReviews(access.guildId, { pendingOnly: true, limit: 20 });
      await reply(
        interaction,
        brand(
          `⚠️ Pending Inactivity Reviews (${list.length})`,
          list.length
            ? list
                .map(
                  (r) =>
                    `• \`${r.review_id}\` — <@${r.staff_user_id}> · ${r.status} · policy \`${r.required_policy}\` · suggested **${formatWarningLevelLabel(r.suggested_level)}**`,
                )
                .join('\n')
            : 'No pending reviews. Inactivity never causes automatic punishment.',
          'warning',
        ),
      );
    },
  },
  {
    root: 'review',
    sub: 'approve',
    description: 'Approve a review (runs live safety rechecks before any warning)',
    options: [
      { kind: 'string', name: 'review_id', description: 'Review ID', required: true },
      { kind: 'string', name: 'reason', description: 'Official warning reason' },
      { kind: 'string', name: 'note', description: 'Management note' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_REVIEWS', 'REVIEW_APPROVE');
      const guild = requireGuild(interaction);
      const ctx = actorCtx(interaction, guild, container);
      const reviewId = interaction.options.getString('review_id', true);
      const res = await container.reviews.initiateWarningApproval(ctx, reviewId, {
        proposedReason: interaction.options.getString('reason', false) ?? undefined,
        proposedNote: interaction.options.getString('note', false) ?? undefined,
        actorDisplayName: interaction.user.username,
      });
      if (res.stage === 'AWAITING_FINAL_CONFIRMATION') {
        await interaction.reply({
          embeds: [
            brand(
              `⚠️ Final Confirmation Required — ${reviewId}`,
              `${res.message}\n\n**Staff:** <@${res.review.staff_user_id}>\n**Level:** ${formatWarningLevelLabel(res.review.suggested_level)}\n**Reason:** ${res.review.proposed_reason ?? '—'}`,
              'danger',
            ),
          ],
          components: [container.reviews.buildFinalConfirmationButtons(reviewId)],
        });
        return;
      }
      if (res.stage !== 'AUTO_CANCELLED') {
        container.audit.log({
          guildId: access.guildId,
          actorUserId: access.userId,
          actionCategory: 'REVIEW',
          actionType: 'REVIEW_APPROVED',
          targetType: 'REVIEW',
          targetId: reviewId,
        });
      }
      await reply(
        interaction,
        brand(
          res.stage === 'AUTO_CANCELLED' ? '✅ Review Auto-Cancelled' : '✅ Approval Recorded',
          res.message,
          res.stage === 'AUTO_CANCELLED' ? 'success' : 'warning',
        ),
      );
    },
  },
  {
    root: 'review',
    sub: 'reject',
    description: 'Reject an inactivity review (no warning is issued)',
    options: [
      { kind: 'string', name: 'review_id', description: 'Review ID', required: true },
      { kind: 'string', name: 'note', description: 'Rejection reason' },
    ],
    handler: async ({ interaction, container }) => {
      await assertLocal(interaction, container, 'SERVER_MANAGE_REVIEWS', 'REVIEW_REJECT');
      const guild = requireGuild(interaction);
      const ctx = actorCtx(interaction, guild, container);
      const updated = container.reviews.rejectReview(
        ctx,
        interaction.options.getString('review_id', true),
        interaction.user.username,
        interaction.options.getString('note', false) ?? undefined,
      );
      await reply(interaction, brand('✖️ Review Rejected', `Review \`${updated.review_id}\` rejected. No warning was issued for <@${updated.staff_user_id}>.`, 'success'));
    },
  },
  {
    root: 'review',
    sub: 'later',
    description: 'Defer a review for later inspection',
    options: [
      { kind: 'string', name: 'review_id', description: 'Review ID', required: true },
      { kind: 'integer', name: 'hours', description: 'Hours to defer (1-168)', minValue: 1, maxValue: 168 },
      { kind: 'string', name: 'note', description: 'Deferral note' },
    ],
    handler: async ({ interaction, container }) => {
      await assertLocal(interaction, container, 'SERVER_MANAGE_REVIEWS', 'REVIEW_LATER');
      const guild = requireGuild(interaction);
      const ctx = actorCtx(interaction, guild, container);
      const updated = container.reviews.deferReviewLater(
        ctx,
        interaction.options.getString('review_id', true),
        interaction.options.getInteger('hours', false) ?? 12,
        interaction.options.getString('note', false) ?? undefined,
      );
      await reply(interaction, brand('⏳ Review Deferred', `Review \`${updated.review_id}\` deferred until **${updated.deferred_until}**.`, 'cyan'));
    },
  },
  {
    root: 'review',
    sub: 'cancel',
    description: 'Cancel an open review with a mandatory reason',
    options: [
      { kind: 'string', name: 'review_id', description: 'Review ID', required: true },
      { kind: 'string', name: 'reason', description: 'Cancellation reason', required: true },
    ],
    handler: async ({ interaction, container }) => {
      await assertLocal(interaction, container, 'SERVER_MANAGE_REVIEWS', 'REVIEW_CANCEL');
      const guild = requireGuild(interaction);
      const ctx = actorCtx(interaction, guild, container);
      const reason = interaction.options.getString('reason', true);
      const cancelled = await container.reviews.cancelReviewByCommand(ctx, interaction.options.getString('review_id', true), reason);
      await reply(interaction, brand('✅ Review Cancelled', `Cancelled review \`${cancelled.review_id}\` for <@${cancelled.staff_user_id}>.\nReason: ${truncate(reason, 200)}`, 'success'));
    },
  },
];
