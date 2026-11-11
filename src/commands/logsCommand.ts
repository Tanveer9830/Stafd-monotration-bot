import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const logsCommand: SlashCommandModule = {
  name: 'logs',
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Audit log viewing and search')
    .addSubcommand((sub) =>
      sub
        .setName('view')
        .setDescription('View guild-isolated audit log entries')
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Entries to show (1-50)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('search')
        .setDescription('Search audit logs by action type')
        .addStringOption((opt) =>
          opt.setName('action_type').setDescription('Action type to search for').setRequired(true),
        )
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Entries to show (1-50)')),
    )
    .addSubcommand((sub) =>
      sub.setName('global').setDescription('View global audit logs (Global Owner only)'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Log commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'global') {
      if (!container.permissions.isGlobalOwner(ctx.userId)) {
        assertAuthorizedOrDenied({
          actorUserId: ctx.userId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/logs global',
          requiredBy: 'GLOBAL_OWNER',
          audit: container.audit,
        });
      }
      const limit = Math.min(Math.max(interaction.options.getInteger('limit', false) ?? 25, 1), 50);
      const logs = container.audit.listGlobalLogs(ctx.userId, true, { limit });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Global Audit Logs (${logs.length})`,
        tone: 'midnight',
        description:
          logs.length === 0
            ? 'No global audit entries recorded.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — Actor \`${l.actor_user_id}\` (${l.guild_id ?? 'GLOBAL'}) at ${l.created_at}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    // view and search require viewer permissions
    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.canViewReports && !perms.isGlobalOwner && !perms.isServerOwner) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/logs ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    const limit = Math.min(Math.max(interaction.options.getInteger('limit', false) ?? 12, 1), 50);

    if (sub === 'view') {
      const logs = container.audit.listGuildLogs(ctx.guildId, { limit });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Server Audit Logs (${logs.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          logs.length === 0
            ? 'No local audit entries recorded yet.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — Actor <@${l.actor_user_id}> at ${l.created_at}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'search') {
      const actionType = interaction.options.getString('action_type', true);
      const logs = container.audit.listGuildLogs(ctx.guildId, { category: actionType, limit });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Audit Log Search — ${actionType} (${logs.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          logs.length === 0
            ? `No audit entries found for action type "${actionType}".`
            : logs
                .map(
                  (l) =>
                    `• \`${l.audit_id}\` **${l.action_type}** — Actor <@${l.actor_user_id}> at ${l.created_at}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
