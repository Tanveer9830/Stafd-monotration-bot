import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { formatSecondsCompact, formatDiscordTimestamp } from '../utils/ids';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const activityCommand: SlashCommandModule = {
  name: 'activity',
  data: new SlashCommandBuilder()
    .setName('activity')
    .setDescription('Staff activity tracking and evidence')
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('List recent qualifying staff activity events')
        .addUserOption((opt) => opt.setName('user').setDescription('Optional staff member filter'))
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Max events to show (1-50)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('View activity profile for a staff member')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub.setName('stats').setDescription('View server-wide activity statistics'),
    )
    .addSubcommand((sub) =>
      sub.setName('export').setDescription('Export activity log (CSV format)'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Activity commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    const perms = container.permissions.evaluateGuildPermissions(ctx);
    if (!perms.canViewReports && !perms.isGlobalOwner && !perms.isServerOwner) {
      assertAuthorizedOrDenied({
        actorUserId: ctx.userId,
        actorTag: ctx.userTag,
        guildId: ctx.guildId,
        actionDescription: `/activity ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'list') {
      const targetUser = interaction.options.getUser('user', false);
      const limit = Math.min(Math.max(interaction.options.getInteger('limit', false) ?? 20, 1), 50);
      const userId = targetUser?.id;
      const events = container.classifier.listStaffActivityEvents(ctx.guildId, userId ?? '', {
        onlyQualifying: true,
        limit,
      });

      const targetUsername = targetUser?.username ?? 'All Staff';
      const embed = createBrandEmbed({
        title: `${emojis.get('active')} Staff Activity Log (${events.length})`,
        tone: 'success',
        subtitle: interaction.guild.name,
        description:
          events.length === 0
            ? 'No qualifying activity events recorded.'
            : events
                .map(
                  (e) =>
                    `• <@${userId ?? 'unknown'}> — \`${e.event_type}\` (${formatDiscordTimestamp(e.occurred_at)})\n  ${e.classification_reason}`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'profile') {
      const targetUser = interaction.options.getUser('user', true);
      const events = container.classifier.listStaffActivityEvents(ctx.guildId, targetUser.id, {
        onlyQualifying: true,
        limit: 25,
      });
      const profile = container.roster.getStaffProfile(ctx.guildId, targetUser.id);

      const embed = createBrandEmbed({
        title: `${emojis.get('performance')} Activity Profile — ${targetUser.username}`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Monitoring Status', value: profile ? profile.monitoring_status : 'NO PROFILE', inline: true },
        { name: 'Last Qualifying Work', value: profile ? formatDiscordTimestamp(profile.last_qualifying_work_at) : 'Never', inline: true },
        { name: 'Last Ticket Activity', value: profile ? formatDiscordTimestamp(profile.last_ticket_activity_at) : 'Never', inline: true },
        {
          name: 'Recent Qualifying Events',
          value:
            events.length === 0
              ? 'No qualifying activity events.'
              : events
                  .map(
                    (e) =>
                      `• \`${e.event_type}\` ${formatDiscordTimestamp(e.occurred_at)} — ${e.classification_reason}`,
                  )
                  .join('\n'),
          inline: false,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'stats') {
      const allStaff = container.roster.listStaffProfiles(ctx.guildId, { onlyActiveStaff: true });
      let totalEvents = 0;
      for (const s of allStaff) {
        const evts = container.classifier.listStaffActivityEvents(ctx.guildId, s.user_id, {
          onlyQualifying: true,
          limit: 1000,
        });
        totalEvents += evts.length;
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Server Activity Statistics`,
        tone: 'purple',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Active Staff', value: `${allStaff.length}`, inline: true },
        { name: 'Total Qualifying Events', value: `${totalEvents}`, inline: true },
        { name: 'Avg Events per Staff', value: `${allStaff.length > 0 ? Math.round(totalEvents / allStaff.length) : 0}`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'export') {
      const allEvents = container.db.all<{
        user_id: string;
        event_type: string;
        classification_reason: string;
        channel_id: string | null;
        occurred_at: string;
      }>(
        `SELECT user_id, event_type, classification_reason, channel_id, occurred_at
         FROM activity_events
         WHERE guild_id = ? AND is_qualifying = 1
         ORDER BY occurred_at DESC`,
        [ctx.guildId],
      );

      const csvLines = ['user_id,event_type,classification_reason,channel_id,occurred_at'];
      for (const e of allEvents) {
        csvLines.push(`${e.user_id},${e.event_type},"${e.classification_reason.replace(/"/g, '""')}",${e.channel_id ?? ''},${e.occurred_at}`);
      }
      const csvContent = csvLines.join('\n');

      const { AttachmentBuilder } = require('discord.js');
      const file = new AttachmentBuilder(Buffer.from(csvContent, 'utf8'), {
        name: `tanveer-activity-${ctx.guildId}-${new Date().toISOString().slice(0, 10)}.csv`,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Activity Log Exported`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Exported **${allEvents.length}** qualifying activity events to CSV.`,
      });
      await interaction.reply({ embeds: [embed], files: [file], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
