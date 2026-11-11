import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord, collectLiveGuildTelemetry } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const scanCommand: SlashCommandModule = {
  name: 'scan',
  data: new SlashCommandBuilder()
    .setName('scan')
    .setDescription('Manual and scheduled roster scans (Server Owner or Global Owner only)')
    .addSubcommand((sub) =>
      sub
        .setName('run')
        .setDescription('Run an immediate full roster scan for this server'),
    )
    .addSubcommand((sub) =>
      sub.setName('schedule').setDescription('View scheduled scan status and next run times'),
    )
    .addSubcommand((sub) =>
      sub.setName('history').setDescription('View recent scan history for this server'),
    )
    .addSubcommand((sub) =>
      sub.setName('cancel').setDescription('Cancel a running scan (Global Owner only)'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Scan commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);
    const actorId = ctx.userId;

    if (sub === 'cancel') {
      if (!container.permissions.isGlobalOwner(actorId)) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/scan cancel',
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
          actionDescription: `/scan ${sub}`,
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }
    }

    if (sub === 'run') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
      const report = await container.scanner.scanGuildRoster(ctx.guildId, {
        trigger: 'MANUAL',
        actorUserId: actorId,
        liveMembers: telemetry.liveMembers,
        livePermissionChecks: telemetry.livePermissionChecks,
        roleHoldersMap: telemetry.roleHoldersMap,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('scanning')} Roster Scan Completed`,
        tone: 'primary',
        subtitle: interaction.guild.name,
        description: report.skippedByLock
          ? 'Another scan is currently executing for this server; duplicate run safely prevented.'
          : `Scanned **${report.totalStaffScanned}** configured staff members under **${report.coverageLevel}** coverage.`,
      }).addFields(
        { name: '🟢 ACTIVE', value: `${report.statusCounts.ACTIVE}`, inline: true },
        { name: '🟡 AT RISK', value: `${report.statusCounts.AT_RISK}`, inline: true },
        { name: '🔴 INACTIVE', value: `${report.statusCounts.INACTIVE}`, inline: true },
        { name: '🔵 ON LEAVE', value: `${report.statusCounts.ON_LEAVE}`, inline: true },
        { name: '🟠 INSUFFICIENT WORKLOAD', value: `${report.statusCounts.INSUFFICIENT_WORKLOAD}`, inline: true },
        { name: '🆕 NEW / ⚪ UNKNOWN', value: `${report.statusCounts.NEW_STAFF} / ${report.statusCounts.UNKNOWN}`, inline: true },
        {
          name: 'Incidents & Reviews',
          value: `Incidents: **${report.incidentsCreatedOrUpdated}** | Escalations: **${report.escalationsTriggered}** | Reviews: **${report.reviewsCreated}**`,
          inline: false,
        },
      );
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === 'schedule') {
      const schedules = container.scheduler.getSchedulerStatus();
      const guildSchedules = schedules.filter((s) => s.lock_name === `guild-scan:${ctx.guildId}`);
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Scheduled Scan Status`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          guildSchedules.length === 0
            ? 'No scheduled scan found for this server.'
            : guildSchedules
                .map(
                  (s) =>
                    `• Lock: \`${s.lock_name}\`\n  Runs: ${s.run_count} | Status: ${s.last_status ?? 'IDLE'} | Next: ${s.next_run_at ?? 'Pending'} | Last Error: ${s.last_error ?? 'None'}`,
                )
                .join('\n\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'history') {
      const logs = container.audit.listGuildLogs(ctx.guildId, {
        category: 'SCANNER',
        limit: 10,
      });
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Scan History (${logs.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          logs.length === 0
            ? 'No scan history recorded.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.action_type}\` by <@${l.actor_user_id}> at ${l.created_at.slice(11, 19)} UTC`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'cancel') {
      const lockName = `guild-scan:${ctx.guildId}`;
      container.db.run(
        `UPDATE scheduler_locks SET holder_id = NULL, expires_at = NULL, last_status = 'CANCELLED', last_error = 'Cancelled by Global Owner' WHERE lock_name = ?`,
        [lockName],
      );
      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Scan Cancelled`,
        tone: 'success',
        description: `Any running scan for server \`${ctx.guildId}\` has been cancelled.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
