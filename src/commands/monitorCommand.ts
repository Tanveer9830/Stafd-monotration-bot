import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied } from '../utils/accessDenied';
import { SlashCommandModule } from './types';
import { FeatureKey } from '../types/domain';

export const monitorCommand: SlashCommandModule = {
  name: 'monitor',
  data: new SlashCommandBuilder()
    .setName('monitor')
    .setDescription('Monitoring controls and configuration (Server Owner or Global Owner only)')
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('View current monitoring status and coverage'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('enable')
        .setDescription('Enable a monitoring feature')
        .addStringOption((opt) =>
          opt
            .setName('feature')
            .setDescription('Feature to enable')
            .setRequired(true)
            .addChoices(
              { name: 'Roster Sync', value: 'roster_sync' },
              { name: 'Scheduled Scanning', value: 'scheduled_scanning' },
              { name: 'Manual Scanning', value: 'manual_scanning' },
              { name: 'Ticket Monitoring', value: 'ticket_monitoring' },
              { name: 'Activity Monitoring', value: 'activity_monitoring' },
              { name: 'Inactivity Detection', value: 'inactivity_detection' },
              { name: 'Warning Delivery', value: 'warning_delivery' },
              { name: 'Analytics', value: 'analytics' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('disable')
        .setDescription('Disable a monitoring feature')
        .addStringOption((opt) =>
          opt
            .setName('feature')
            .setDescription('Feature to disable')
            .setRequired(true)
            .addChoices(
              { name: 'Roster Sync', value: 'roster_sync' },
              { name: 'Scheduled Scanning', value: 'scheduled_scanning' },
              { name: 'Manual Scanning', value: 'manual_scanning' },
              { name: 'Ticket Monitoring', value: 'ticket_monitoring' },
              { name: 'Activity Monitoring', value: 'activity_monitoring' },
              { name: 'Inactivity Detection', value: 'inactivity_detection' },
              { name: 'Warning Delivery', value: 'warning_delivery' },
              { name: 'Analytics', value: 'analytics' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('config').setDescription('View monitoring configuration and thresholds'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Monitor commands must be executed inside a Discord server.');
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
        actionDescription: `/monitor ${sub}`,
        requiredBy: 'GLOBAL_OR_SERVER_OWNER',
        audit: container.audit,
      });
    }

    if (sub === 'status') {
      const cfg = container.guildConfig.getGuildConfigOrThrow(ctx.guildId);
      const diag = container.tickets.runDiagnostics(ctx.guildId);
      const features = container.features.listGuildFeatures(ctx.guildId);
      const enabled = features.filter((f) => f.effectiveEnabled).length;

      const embed = createBrandEmbed({
        title: `${emojis.get('performance')} Monitoring Status — ${cfg.guild_name}`,
        tone: diag.coverageLevel === 'FULL' ? 'success' : diag.coverageLevel === 'PARTIAL' ? 'warning' : 'danger',
        subtitle: `Coverage: ${diag.coverageLevel}`,
      }).addFields(
        { name: 'Overall Coverage', value: diag.coverageLevel, inline: true },
        { name: 'Accessible Targets', value: `${diag.accessibleCount}`, inline: true },
        { name: 'Inaccessible Targets', value: `${diag.inaccessibleCount}`, inline: true },
        { name: 'Features Enabled', value: `${enabled}/${features.length}`, inline: true },
        { name: 'Scan Interval', value: `${cfg.scan_interval_minutes} min`, inline: true },
        { name: 'Scheduler Status', value: container.scheduler.getSchedulerStatus().length > 0 ? 'Active' : 'Idle', inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'enable' || sub === 'disable') {
      const feature = interaction.options.getString('feature', true) as FeatureKey;
      const enabled = sub === 'enable';
      const updated = container.features.setGuildFeature(ctx.guildId, ctx.userId, feature, enabled);
      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Monitoring Feature Updated`,
        tone: 'success',
        description: `Feature \`${updated.key}\` is now **${updated.effectiveEnabled ? 'ENABLED' : 'DISABLED'}**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'config') {
      const cfg = container.guildConfig.getGuildConfigOrThrow(ctx.guildId);
      const features = container.features.listGuildFeatures(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Monitoring Configuration — ${cfg.guild_name}`,
        tone: 'purple',
        subtitle: `Guild ID: ${cfg.guild_id}`,
      }).addFields(
        { name: 'At-Risk Threshold', value: `${cfg.at_risk_hours}h`, inline: true },
        { name: 'Inactive Threshold', value: `${cfg.inactive_hours}h`, inline: true },
        { name: 'Escalation Threshold', value: `${cfg.escalation_hours}h`, inline: true },
        { name: 'New Staff Baseline', value: `${cfg.observation_baseline_hours}h`, inline: true },
        { name: 'Scan Interval', value: `${cfg.scan_interval_minutes} min`, inline: true },
        { name: 'Baseline Completed', value: cfg.baseline_completed_at ? 'Yes' : 'No', inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
