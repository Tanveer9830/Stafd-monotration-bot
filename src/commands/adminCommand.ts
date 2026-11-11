import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied, createAccessDeniedEmbed } from '../utils/accessDenied';
import { SlashCommandModule } from './types';
import { BotAdminScope } from '../types/domain';

export const adminCommand: SlashCommandModule = {
  name: 'admin',
  data: new SlashCommandBuilder()
    .setName('admin')
    .setDescription('Manage Global Owner-appointed bot administrators')
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Appoint an authorized bot administrator (Global Owner only)')
        .addUserOption((opt) => opt.setName('user').setDescription('Discord user to appoint').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('scopes')
            .setDescription('Comma-separated scopes')
            .setRequired(false)
            .addChoices(
              { name: 'VIEW_GLOBAL_STATS', value: 'VIEW_GLOBAL_STATS' },
              { name: 'VIEW_GUILDS', value: 'VIEW_GUILDS' },
              { name: 'INSPECT_DIAGNOSTICS', value: 'INSPECT_DIAGNOSTICS' },
              { name: 'VIEW_AUDIT_LOGS', value: 'VIEW_AUDIT_LOGS' },
              { name: 'REVIEW_CASES', value: 'REVIEW_CASES' },
            ),
        )
        .addStringOption((opt) => opt.setName('notes').setDescription('Appointment notes').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Revoke an authorized bot administrator (Global Owner only)')
        .addUserOption((opt) => opt.setName('user').setDescription('Bot administrator to revoke').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List all authorized bot administrators'))
    .addSubcommand((sub) =>
      sub
        .setName('scopes')
        .setDescription('View or update bot administrator scopes (Global Owner only)')
        .addUserOption((opt) => opt.setName('user').setDescription('Bot administrator').setRequired(true)),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    const actorId = interaction.user.id;
    const sub = interaction.options.getSubcommand(true);

    // Global Owner only for all admin operations
    if (!isPermanentGlobalOwner(actorId)) {
      assertAuthorizedOrDenied({
        actorUserId: actorId,
        actorTag: interaction.user.tag,
        guildId: interaction.guildId ?? null,
        actionDescription: `/admin ${sub}`,
        requiredBy: 'GLOBAL_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'add') {
      const target = interaction.options.getUser('user', true);
      const rawScopes = interaction.options.getString('scopes', false);
      const notes = interaction.options.getString('notes', false) ?? undefined;

      const validScopes: BotAdminScope[] = [
        'VIEW_GLOBAL_STATS',
        'VIEW_GUILDS',
        'INSPECT_DIAGNOSTICS',
        'VIEW_AUDIT_LOGS',
        'REVIEW_CASES',
      ];
      const parsedScopes: BotAdminScope[] = rawScopes
        ? rawScopes.split(',').map((s) => s.trim().toUpperCase() as BotAdminScope).filter((s) => validScopes.includes(s))
        : ['VIEW_GLOBAL_STATS', 'VIEW_GUILDS', 'INSPECT_DIAGNOSTICS'];

      const saved = container.permissions.addBotAdmin(actorId, target.id, target.username, parsedScopes, notes);
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Bot Administrator Appointed`,
        tone: 'success',
        description: `Appointed **${saved.username}** (\`${saved.user_id}\`) as an authorized Bot Administrator.`,
      }).addFields(
        { name: 'Granted Scopes', value: saved.scopes.map((s) => `\`${s}\``).join(', ') || 'None', inline: false },
        { name: 'Security Note', value: 'Bot Administrators can never appoint Global Owners or other Bot Admins.', inline: false },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'remove') {
      const target = interaction.options.getUser('user', true);
      const removed = container.permissions.removeBotAdmin(actorId, target.id);
      const embed = createBrandEmbed({
        title: removed ? `${emojis.get('success')} Bot Administrator Revoked` : `${emojis.get('warning')} Not Found`,
        tone: removed ? 'success' : 'warning',
        description: removed
          ? `Revoked all Bot Administrator privileges from **${target.username}** (\`${target.id}\`).`
          : `User \`${target.id}\` was not registered as an active Bot Administrator.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'list') {
      const admins = container.permissions.listBotAdmins();
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Authorized Bot Administrators (${admins.length})`,
        tone: 'cyan',
        description:
          admins.length === 0
            ? 'No subordinate Bot Administrators are currently appointed.'
            : admins
                .map(
                  (a) =>
                    `• **${a.username}** (\`${a.user_id}\`) — Scopes: ${a.scopes.map((s) => `\`${s}\``).join(', ')}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'scopes') {
      const target = interaction.options.getUser('user', true);
      const admin = container.permissions.getBotAdmin(target.id);
      if (!admin) {
        const embed = createBrandEmbed({
          title: `${emojis.get('warning')} Not Found`,
          tone: 'warning',
          description: `User \`${target.id}\` is not registered as an active Bot Administrator.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Bot Administrator Scopes — ${admin.username}`,
        tone: 'cyan',
        description: `**User:** \`${admin.user_id}\`\n**Scopes:** ${admin.scopes.map((s) => `\`${s}\``).join(', ') || 'None'}`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
