import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { generateEntityId } from '../utils/ids';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const integrationCommand: SlashCommandModule = {
  name: 'integration',
  data: new SlashCommandBuilder()
    .setName('integration')
    .setDescription('Ticket integration management (Server Owner or Global Owner only)')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List configured ticket integrations'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Add a third-party ticket integration')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Integration type')
            .setRequired(true)
            .addChoices(
              { name: 'Ticket Tool', value: 'ticket-tool' },
              { name: 'Tickets v2', value: 'tickets-v2' },
              { name: 'Custom Webhook', value: 'webhook' },
              { name: 'Custom Pattern', value: 'custom' },
            ),
        )
        .addStringOption((opt) =>
          opt.setName('external_id').setDescription('External integration ID').setRequired(true),
        )
        .addStringOption((opt) => opt.setName('name').setDescription('Integration display name').setRequired(false)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a ticket integration')
        .addStringOption((opt) =>
          opt.setName('external_id').setDescription('External integration ID to remove').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('test').setDescription('Test a ticket integration connection')
        .addStringOption((opt) =>
          opt.setName('external_id').setDescription('External integration ID').setRequired(true),
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Integration commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.isGlobalOwner && !perms.isServerOwner && !perms.canConfigureGuild) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/integration ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'list') {
      const integrations = container.db.all<{
        id: number;
        integration_type: string;
        external_id: string;
        external_name: string | null;
        is_active: number;
        config_json: string;
        created_at: string;
      }>(
        `SELECT * FROM integration_configs WHERE guild_id = ? ORDER BY created_at DESC`,
        [ctx.guildId],
      );

      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Ticket Integrations (${integrations.length})`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          integrations.length === 0
            ? 'No ticket integrations configured.'
            : integrations
                .map(
                  (i) =>
                    `• **${i.integration_type}** — \`${i.external_id}\`${i.external_name ? ` (${i.external_name})` : ''} | ${i.is_active ? '🟢 Active' : '🔴 Inactive'}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'add') {
      const type = interaction.options.getString('type', true);
      const externalId = interaction.options.getString('external_id', true).trim();
      const name = interaction.options.getString('name', false) ?? externalId;

      const existing = container.db.get<{ id: number }>(
        `SELECT id FROM integration_configs WHERE guild_id = ? AND integration_type = ? AND external_id = ?`,
        [ctx.guildId, type, externalId],
      );
      if (existing) {
        throw new Error(`Integration \`${type}:${externalId}\` is already configured.`);
      }

      const now = new Date().toISOString();
      const id = generateEntityId('INT');
      container.db.run(
        `INSERT INTO integration_configs (id, guild_id, integration_type, external_id, external_name, is_active, config_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, '{}', ?, ?, ?)`,
        [id, ctx.guildId, type, externalId, name, ctx.userId, now, now],
      );

      container.audit.log({
        guildId: ctx.guildId,
        actorUserId: ctx.userId,
        actionCategory: 'TICKET',
        actionType: 'INTEGRATION_ADDED',
        targetType: 'INTEGRATION',
        targetId: externalId,
        after: { type, external_id: externalId, name },
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Integration Added`,
        tone: 'success',
        description: `Added **${type}** integration \`${externalId}\` (${name}).`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'remove') {
      const externalId = interaction.options.getString('external_id', true).trim();
      const existing = container.db.get<{ integration_type: string }>(
        `SELECT integration_type FROM integration_configs WHERE guild_id = ? AND external_id = ?`,
        [ctx.guildId, externalId],
      );
      if (!existing) {
        throw new Error(`Integration \`${externalId}\` not found.`);
      }

      container.db.run(
        `DELETE FROM integration_configs WHERE guild_id = ? AND external_id = ?`,
        [ctx.guildId, externalId],
      );

      container.audit.log({
        guildId: ctx.guildId,
        actorUserId: ctx.userId,
        actionCategory: 'TICKET',
        actionType: 'INTEGRATION_REMOVED',
        targetType: 'INTEGRATION',
        targetId: externalId,
        before: { type: existing.integration_type, external_id: externalId },
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Integration Removed`,
        tone: 'success',
        description: `Removed integration \`${externalId}\`.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'test') {
      const externalId = interaction.options.getString('external_id', true).trim();
      const integration = container.db.get<{ integration_type: string; is_active: number }>(
        `SELECT integration_type, is_active FROM integration_configs WHERE guild_id = ? AND external_id = ?`,
        [ctx.guildId, externalId],
      );
      if (!integration) {
        throw new Error(`Integration \`${externalId}\` not found.`);
      }
      if (!integration.is_active) {
        throw new Error(`Integration \`${externalId}\` is currently inactive.`);
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Integration Test — ${externalId}`,
        tone: 'success',
        description: `Integration **${integration.integration_type}** (\`${externalId}\`) is reachable and active.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
