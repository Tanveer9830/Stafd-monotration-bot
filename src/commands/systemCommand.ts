import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const systemCommand: SlashCommandModule = {
  name: 'system',
  data: new SlashCommandBuilder()
    .setName('system')
    .setDescription('Bot health and diagnostics (Server Owner or Global Owner only)')
    .addSubcommand((sub) => sub.setName('health').setDescription('View overall system health'))
    .addSubcommand((sub) =>
      sub.setName('diagnostics').setDescription('View detailed ticket engine diagnostics'),
    )
    .addSubcommand((sub) => sub.setName('info').setDescription('View bot system information'))
    .addSubcommand((sub) =>
      sub
        .setName('scheduler')
        .setDescription('View scheduler status and pending tasks'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('System commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'health') {
      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (!perms.isGlobalOwner && !perms.isServerOwner && !perms.canViewReports) {
        assertAuthorizedOrDenied({
          actorUserId: ctx.userId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/system health',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }

      const integrity = container.db.integrityCheck();
      const diag = container.tickets.runDiagnostics(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('performance')} System Health — ${interaction.guild.name}`,
        tone: integrity.ok ? 'success' : 'danger',
        subtitle: `Guild ID: ${ctx.guildId}`,
      }).addFields(
        { name: 'Database Integrity', value: integrity.ok ? '🟢 OK' : `🔴 ${integrity.details.join(', ')}`, inline: true },
        { name: 'Monitoring Coverage', value: diag.coverageLevel, inline: true },
        { name: 'Accessible Targets', value: `${diag.accessibleCount}`, inline: true },
        { name: 'Inaccessible Targets', value: `${diag.inaccessibleCount}`, inline: true },
        { name: 'Scheduler Locks', value: `${container.scheduler.getSchedulerStatus().length}`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'diagnostics') {
      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (!perms.isGlobalOwner && !perms.isServerOwner && !perms.canConfigureGuild) {
        assertAuthorizedOrDenied({
          actorUserId: ctx.userId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/system diagnostics',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }

      const diag = container.tickets.runDiagnostics(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Ticket Engine Diagnostics`,
        tone: diag.coverageLevel === 'FULL' ? 'success' : 'warning',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Coverage', value: diag.coverageLevel, inline: true },
        { name: 'Accessible', value: `${diag.accessibleCount}`, inline: true },
        { name: 'Inaccessible', value: `${diag.inaccessibleCount}`, inline: true },
        {
          name: 'Adapters',
          value: diag.adapterReports.map((a) => `**${a.adapterName}**: ${a.healthy ? '🟢' : '🟡'}`).join(', ') || 'None',
          inline: false,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'info') {
      if (!isPermanentGlobalOwner(ctx.userId)) {
        assertAuthorizedOrDenied({
          actorUserId: ctx.userId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/system info',
          requiredBy: 'GLOBAL_OWNER',
          audit: container.audit,
        });
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('owner')} Bot System Information`,
        tone: 'primary',
        description: `**Platform:** TANVEER STAFF MONITOR\n**Creator:** MADE BY TANVEER\n**Global Owner ID:** \`${GLOBAL_OWNER_ID}\`\n**Database:** SQLite WAL\n**Driver:** ${container.db.driverName}\n**Database Path:** ${container.db.dbPath}`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'scheduler') {
      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (!perms.isGlobalOwner && !perms.isServerOwner && !perms.canConfigureGuild) {
        assertAuthorizedOrDenied({
          actorUserId: ctx.userId,
          actorTag: ctx.userTag,
          guildId: ctx.guildId,
          actionDescription: '/system scheduler',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }

      const schedules = container.scheduler.getSchedulerStatus();
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Scheduler Status (${schedules.length})`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          schedules.length === 0
            ? 'No scheduler entries.'
            : schedules
                .map(
                  (s) =>
                    `• \`${s.lock_name}\` — Runs: ${s.run_count} | Status: ${s.last_status ?? 'IDLE'} | Next: ${s.next_run_at ?? 'Pending'} | Error: ${s.last_error ?? 'None'}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
