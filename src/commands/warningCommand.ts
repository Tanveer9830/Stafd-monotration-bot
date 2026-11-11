import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { APPROVAL_POLICY_LABELS, ApprovalPolicy } from '../types/domain';
import { formatWarningLevelLabel } from '../services/WarningService';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { SlashCommandModule } from './types';

export const warningCommand: SlashCommandModule = {
  name: 'warning',
  data: new SlashCommandBuilder()
    .setName('warning')
    .setDescription('Complete staff warning management, official DM delivery, removals & appeals')
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('View server-wide or staff-specific warning history')
        .addUserOption((opt) => opt.setName('user').setDescription('Optional staff member filter')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('Inspect active warning progression (1/3–3/3) and appeal status for a staff member')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('issue')
        .setDescription('Manually issue an authorized official staff warning')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to warn').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Official warning reason').setRequired(true))
        .addStringOption((opt) => opt.setName('note').setDescription('Optional management note'))
        .addIntegerOption((opt) =>
          opt
            .setName('level')
            .setDescription('Optional explicit warning level (1-3; defaults to progressive next level)')
            .addChoices(
              { name: 'Warning 1/3', value: 1 },
              { name: 'Warning 2/3', value: 2 },
              { name: 'Warning 3/3 — Final warning / Management review', value: 3 },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove an active warning (mandatory audit reason required)')
        .addStringOption((opt) => opt.setName('warning_id').setDescription('Warning ID (WRN-...)').setRequired(true))
        .addStringOption((opt) => opt.setName('reason').setDescription('Mandatory reason for removal').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('appeal')
        .setDescription('Submit a warning appeal or decide a pending appeal')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Submit new appeal or review pending appeal')
            .setRequired(true)
            .addChoices(
              { name: 'Submit Appeal (Warned Staff)', value: 'submit' },
              { name: 'Approve Appeal & Overturn Warning (Management)', value: 'approve' },
              { name: 'Reject Appeal (Management)', value: 'reject' },
              { name: 'List Pending Appeals (Management)', value: 'list' },
            ),
        )
        .addStringOption((opt) =>
          opt.setName('target_id').setDescription('Warning ID (for submit) or Appeal ID (for approve/reject)'),
        )
        .addStringOption((opt) => opt.setName('reason').setDescription('Appeal explanation or decision note')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Configure warning expiration days and local approval policy override')
        .addIntegerOption((opt) => opt.setName('expiry_days').setDescription('Days until warnings expire (0 = never)'))
        .addStringOption((opt) =>
          opt
            .setName('approval_policy')
            .setDescription('Local warning approval policy (subject to Global Owner policy lock)')
            .addChoices(
              { name: 'Use Global Default', value: 'DEFAULT' },
              { name: 'Any Authorized Reviewer', value: 'ANY_AUTHORIZED_REVIEWER' },
              { name: 'Global Owner Required', value: 'GLOBAL_OWNER_REQUIRED' },
              { name: 'Two-Person Approval', value: 'TWO_PERSON_APPROVAL' },
              { name: 'Global Owner + Server Owner Dual Approval', value: 'GLOBAL_AND_SERVER_OWNER' },
            ),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Warning commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'history') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'WARNING_HISTORY');
      const filterUser = interaction.options.getUser('user', false);
      const list = container.warnings.listWarnings(ctx.guildId, { staffUserId: filterUser?.id, limit: 20 });

      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Warning History (${list.length})`,
        tone: 'warning',
        subtitle: interaction.guild.name,
        description:
          list.length === 0
            ? 'No warning records found.'
            : list
                .map(
                  (w) =>
                    `• \`${w.warning_id}\` — <@${w.staff_user_id}> | **${formatWarningLevelLabel(w.warning_level)}** [\`${w.status}\`]\n` +
                    `  Approved by: ${w.approver_display_name} (\`${w.approver_id}\`) | DM: ${w.dm_delivered ? '✅' : '⚠️ Failed'}\n` +
                    `  Reason: *${w.reason}*`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'profile') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'WARNING_PROFILE');
      const targetUser = interaction.options.getUser('user', true);
      const activeWarns = container.warnings.listWarnings(ctx.guildId, {
        staffUserId: targetUser.id,
        onlyActive: true,
      });
      const allWarns = container.warnings.listWarnings(ctx.guildId, { staffUserId: targetUser.id });
      const nextLevel = container.warnings.computeNextWarningLevel(ctx.guildId, targetUser.id);

      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Warning Standing Profile — ${targetUser.username}`,
        tone: activeWarns.length >= 2 ? 'danger' : activeWarns.length === 1 ? 'warning' : 'success',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Active Warnings', value: `**${activeWarns.length} / 3**`, inline: true },
        { name: 'Historical Total', value: `${allWarns.length}`, inline: true },
        { name: 'Next Progressive Level', value: formatWarningLevelLabel(nextLevel), inline: true },
        {
          name: 'Active Records',
          value:
            activeWarns.length === 0
              ? 'Clean active standing.'
              : activeWarns
                  .map(
                    (w) =>
                      `• \`${w.warning_id}\` (Level ${w.warning_level}/3) — ${w.reason}${w.expires_at ? ` [Expires ${w.expires_at.slice(0, 10)}]` : ''}`,
                  )
                  .join('\n'),
          inline: false,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'issue') {
      container.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'WARNING_ISSUE');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const targetUser = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const note = interaction.options.getString('note', false);
      const explicitLevel = interaction.options.getInteger('level', false) as 1 | 2 | 3 | null;

      const warning = await container.warnings.issueWarning({
        guildId: ctx.guildId,
        staffUserId: targetUser.id,
        reason,
        managementNote: note,
        issuedById: ctx.userId,
        approverId: ctx.userId,
        approverDisplayName: interaction.user.username,
        explicitLevel: explicitLevel ?? undefined,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Official Warning Issued — \`${warning.warning_id}\``,
        tone: warning.warning_level >= 3 ? 'danger' : 'warning',
        subtitle: interaction.guild.name,
        description:
          `Issued **${formatWarningLevelLabel(warning.warning_level)}** to <@${warning.staff_user_id}>.\n` +
          `**DM Delivery:** ${warning.dm_delivered ? '✅ Delivered via Official Bot DM' : `⚠️ Failed (${warning.dm_error}) — Management fallback recorded.`}` +
          (warning.requires_management_review
            ? '\n**Notice:** Level 3/3 reached — flagged for human management review only (no automatic kick, ban, or role removal).'
            : ''),
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'remove') {
      container.permissions.assertGuildCapability(ctx, 'canApproveWarnings', 'WARNING_REMOVE');
      const warningId = interaction.options.getString('warning_id', true).trim();
      const removalReason = interaction.options.getString('reason', true);

      const removed = container.warnings.removeWarning({
        guildId: ctx.guildId,
        warningId,
        actorUserId: ctx.userId,
        removalReason,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Warning Removed & Audited — \`${removed.warning_id}\``,
        tone: 'success',
        subtitle: interaction.guild.name,
        description: `Removed warning \`${removed.warning_id}\` for <@${removed.staff_user_id}>.\n**Recorded Audit Reason:** ${removed.removed_reason}`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'appeal') {
      const action = interaction.options.getString('action', true);
      const targetId = interaction.options.getString('target_id', false)?.trim();
      const reason = interaction.options.getString('reason', false) ?? '';

      if (action === 'submit') {
        if (!targetId) {
          throw new Error('Please supply `target_id` with your Warning ID (WRN-...) to submit an appeal.');
        }
        const appeal = container.warnings.submitAppeal({
          guildId: ctx.guildId,
          warningId: targetId,
          staffUserId: ctx.userId,
          appealReason: reason,
        });

        const embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Warning Appeal Submitted — \`${appeal.appeal_id}\``,
          tone: 'cyan',
          description: `Your appeal for warning \`${appeal.warning_id}\` has been recorded for management review.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      container.permissions.assertGuildCapability(ctx, 'canApproveWarnings', `WARNING_APPEAL_${action.toUpperCase()}`);

      if (action === 'list') {
        const list = container.warnings.listAppeals(ctx.guildId, 'PENDING', 20);
        const embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Pending Warning Appeals (${list.length})`,
          tone: 'cyan',
          description:
            list.length === 0
              ? 'No pending appeals.'
              : list
                  .map(
                    (a) =>
                      `• \`${a.appeal_id}\` (Warning \`${a.warning_id}\`) — Staff <@${a.staff_user_id}>\n  Reason: *${a.appeal_reason}*`,
                  )
                  .join('\n\n'),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (!targetId) {
        throw new Error('Please supply `target_id` with the Appeal ID (APL-...) to approve or reject.');
      }

      const decided = container.warnings.decideAppeal({
        guildId: ctx.guildId,
        appealId: targetId,
        actorUserId: ctx.userId,
        actorDisplayName: interaction.user.username,
        decision: action === 'approve' ? 'APPROVED' : 'REJECTED',
        decisionNote: reason,
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

    if (sub === 'config') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'WARNING_CONFIG');
      const expiryDays = interaction.options.getInteger('expiry_days', false) ?? undefined;
      const rawPolicy = interaction.options.getString('approval_policy', false);

      const updated = container.guildConfig.updateWarningConfig(ctx.guildId, ctx.userId, {
        warningExpiryDays: expiryDays,
        approvalPolicyOverride:
          rawPolicy === null
            ? undefined
            : rawPolicy === 'DEFAULT'
              ? null
              : (rawPolicy as ApprovalPolicy),
      });

      const effectivePolicy = container.guildConfig.resolveEffectiveApprovalPolicy(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Warning Configuration Updated`,
        tone: 'purple',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Warning Expiration', value: updated.warning_expiry_days === 0 ? 'Never Expire' : `${updated.warning_expiry_days} days`, inline: true },
        { name: 'Effective Approval Policy', value: APPROVAL_POLICY_LABELS[effectivePolicy], inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
