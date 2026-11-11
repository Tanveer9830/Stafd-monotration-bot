import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { generateEntityId } from '../utils/ids';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const notificationCommand: SlashCommandModule = {
  name: 'notification',
  data: new SlashCommandBuilder()
    .setName('notification')
    .setDescription('Notification management (Server Owner or Global Owner only)')
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('List notification history for this server'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('config')
        .setDescription('Configure notification delivery for a type')
        .addStringOption((opt) =>
          opt
            .setName('type')
            .setDescription('Notification type')
            .setRequired(true)
            .addChoices(
              { name: 'Warning DM', value: 'warning_dm' },
              { name: 'Warning Level 3 Review', value: 'warning_level_3' },
              { name: 'Inactivity Review', value: 'inactivity_review' },
              { name: 'Review Cancelled', value: 'review_cancelled' },
              { name: 'Leave Approved', value: 'leave_approved' },
              { name: 'Leave Rejected', value: 'leave_rejected' },
              { name: 'System Alert', value: 'system_alert' },
              { name: 'Audit Alert', value: 'audit_alert' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Delivery channel (DM, CHANNEL_FALLBACK, GLOBAL_INBOX_ONLY, DISABLED)')
            .setRequired(true)
            .addChoices(
              { name: 'DM', value: 'DM' },
              { name: 'Channel Fallback', value: 'CHANNEL_FALLBACK' },
              { name: 'Global Inbox Only', value: 'GLOBAL_INBOX_ONLY' },
              { name: 'Disabled', value: 'DISABLED' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Send a test notification')
        .addStringOption((opt) =>
          opt.setName('type').setDescription('Notification type to test').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('global').setDescription('View Global Owner inbox (Global Owner only)'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Notification commands must be executed inside a Discord server.');
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
          actionDescription: '/notification global',
          requiredBy: 'GLOBAL_OWNER',
          audit: container.audit,
        });
      }
      const inbox = container.notifications.listGlobalOwnerInbox(ctx.userId, false, 10);
      const embed = createBrandEmbed({
        title: `${emojis.get('notifications')} Global Owner Inbox (${inbox.length})`,
        tone: 'cyan',
        description: `Global Owner ID: \`${ctx.userId}\``,
      }).addFields(
        {
          name: 'Recent Notifications',
          value:
            inbox.length === 0
              ? 'Inbox is empty.'
              : inbox.map((n) => `• \`${n.notification_type}\`: ${n.summary}`).join('\n'),
          inline: false,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.isGlobalOwner && !perms.isServerOwner && !perms.canConfigureGuild) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/notification ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'list') {
      const notifications = container.db.all<{
        notification_id: string;
        notification_type: string;
        title: string;
        summary: string;
        delivery_channel: string;
        delivered: number;
        created_at: string;
      }>(
        `SELECT * FROM notification_history WHERE guild_id = ? ORDER BY created_at DESC LIMIT 25`,
        [ctx.guildId],
      );
      const embed = createBrandEmbed({
        title: `${emojis.get('notifications')} Notification History (${notifications.length})`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          notifications.length === 0
            ? 'No notifications recorded.'
            : notifications
                .map(
                  (n) =>
                    `• \`${n.notification_type}\` — ${n.title} | ${n.delivery_channel} | ${n.delivered ? '✅ Delivered' : '❌ Failed'}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'config') {
      const type = interaction.options.getString('type', true);
      const channel = interaction.options.getString('channel', true);
      const now = new Date().toISOString();

      const existing = container.db.get<{ id: number }>(
        `SELECT id FROM notification_configs WHERE guild_id = ? AND notification_type = ?`,
        [ctx.guildId, type],
      );

      if (existing) {
        container.db.run(
          `UPDATE notification_configs SET delivery_channel = ?, updated_by = ?, updated_at = ? WHERE guild_id = ? AND notification_type = ?`,
          [channel, ctx.userId, now, ctx.guildId, type],
        );
      } else {
        const id = generateEntityId('NTC');
        container.db.run(
          `INSERT INTO notification_configs (id, guild_id, notification_type, delivery_channel, channel_id, is_enabled, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 1, ?, ?, ?)`,
          [id, ctx.guildId, type, channel, ctx.userId, now, now],
        );
      }

      container.audit.log({
        guildId: ctx.guildId,
        actorUserId: ctx.userId,
        actionCategory: 'SETTINGS',
        actionType: 'NOTIFICATION_CONFIG_UPDATED',
        targetType: 'NOTIFICATION',
        targetId: type,
        after: { type, delivery_channel: channel },
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Notification Config Updated`,
        tone: 'success',
        description: `Notification type **${type}** delivery set to **${channel}**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'test') {
      const type = interaction.options.getString('type', true);
      const embed = createBrandEmbed({
        title: `${emojis.get('notifications')} Test Notification — ${type}`,
        tone: 'success',
        description: `This is a test notification for type **${type}**. Delivery system is operational.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
