import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';
import { APPROVAL_POLICY_LABELS } from '../types/domain';

export const securityCommand: SlashCommandModule = {
  name: 'security',
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Security and permissions management (Server Owner or Global Owner only)')
    .addSubcommand((sub) =>
      sub.setName('policy').setDescription('View global security and approval policies (Global Owner only)'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('permissions')
        .setDescription('View or manage guild permission assignments'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('audit')
        .setDescription('View security-related audit log entries'),
    )
    .addSubcommand((sub) =>
      sub.setName('features').setDescription('View global feature restrictions (Global Owner only)'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Security commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);
    const actorId = ctx.userId;

    if (sub === 'policy' || sub === 'features') {
      if (!isPermanentGlobalOwner(actorId)) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: `/security ${sub}`,
          requiredBy: 'GLOBAL_OWNER',
          audit: container.audit,
        });
      }
    } else {
      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (!perms.isGlobalOwner && !perms.isServerOwner && !perms.canConfigureGuild) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: `/security ${sub}`,
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }
    }

    if (sub === 'policy') {
      const globalCfg = container.guildConfig.getGlobalConfig();
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Global Security & Approval Policies`,
        tone: 'primary',
        description: `Immutable Global Owner ID: \`${GLOBAL_OWNER_ID}\``,
      }).addFields(
        {
          name: 'Global Approval Policy',
          value: `${APPROVAL_POLICY_LABELS[globalCfg.global_approval_policy]} (\`${globalCfg.global_approval_policy}\`)`,
          inline: false,
        },
        { name: 'Allow Guild Policy Override', value: globalCfg.allow_guild_policy_override ? 'Enabled' : 'Locked Globally', inline: true },
        { name: 'At-Risk Bounds', value: `${globalCfg.min_at_risk_hours}h – ${globalCfg.max_at_risk_hours}h`, inline: true },
        { name: 'Inactive Bounds', value: `${globalCfg.min_inactive_hours}h – ${globalCfg.max_inactive_hours}h`, inline: true },
        { name: 'Escalation Bounds', value: `${globalCfg.min_escalation_hours}h – ${globalCfg.max_escalation_hours}h`, inline: true },
        { name: 'Rate Limit', value: `${globalCfg.rate_limit_actions_per_minute} actions/min`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'permissions') {
      const list = container.permissions.listGuildPermissionAssignments(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Permission Assignments (${list.length})`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description:
          list.length === 0
            ? 'Only Global Owner and Discord Server Owner are currently configured.'
            : list
                .map(
                  (a) =>
                    `• \`${a.target_type}\` ${a.target_type === 'USER' ? `<@${a.target_id}>` : `<@&${a.target_id}>`} (\`${a.target_id}\`) — **${a.permission_level}**`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'audit') {
      const logs = container.audit.listGuildLogs(ctx.guildId, {
        category: 'UNAUTHORIZED_ATTEMPT',
        limit: 25,
      });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Security Audit Logs (${logs.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          logs.length === 0
            ? 'No unauthorized access attempts recorded.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — Actor \`${l.actor_user_id}\` at ${l.created_at}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'features') {
      const disabled = container.features.getGloballyDisabledFeatures();
      const domain = require('../types/domain');
      const ALL_FEATURE_KEYS = domain.ALL_FEATURE_KEYS as readonly string[];
      const embed = createBrandEmbed({
        title: `${emojis.get('premium')} Global Feature Restrictions`,
        tone: 'purple',
        description: ALL_FEATURE_KEYS.map(
          (k) => `${disabled.has(k as never) ? '🔒 **LOCKED OFF**' : '🟢 **ALLOWED**'} — \`${k}\` (${domain.FEATURE_LABELS[k as never]})`,
        ).join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
