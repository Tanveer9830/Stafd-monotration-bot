import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { assertAuthorizedOrDenied, createAccessDeniedEmbed } from '../utils/accessDenied';
import { SlashCommandModule } from './types';

export const serverCommand: SlashCommandModule = {
  name: 'server',
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Server management operations (Server Owner or Global Owner only)')
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('Inspect this server configuration and ownership'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('register')
        .setDescription('Register this server with the bot (Server Owner or Global Owner only)'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('owner')
        .setDescription('View or transfer server ownership (Global Owner only)')
        .addUserOption((opt) =>
          opt.setName('new_owner').setDescription('New server owner Discord User ID').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Have the bot leave this server (Global Owner only)')
        .addStringOption((opt) => opt.setName('guild_id').setDescription('Target Guild ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('settings')
        .setDescription('View all server settings (Server Owner or Global Owner only)'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Server commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);
    const actorId = interaction.user.id;
    const isGlobalOwner = container.permissions.isGlobalOwner(actorId);
    const perms = container.permissions.evaluateGuildPermissions(ctx);
    const isServerOwner = perms.isServerOwner || interaction.user.id === interaction.guild.ownerId;

    if (sub === 'info') {
      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (!perms.isGlobalOwner && !perms.isServerOwner) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: interaction.user.tag,
          guildId: ctx.guildId,
          actionDescription: '/server info',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }
      const cfg = container.guildConfig.getGuildConfigOrThrow(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('owner')} Server Information — ${cfg.guild_name}`,
        tone: 'primary',
        subtitle: `Guild ID: ${cfg.guild_id}`,
      }).addFields(
        { name: 'Discord Server Owner', value: `\`${cfg.owner_id}\``, inline: true },
        { name: 'Bot Registered', value: 'Yes', inline: true },
        { name: 'Alert Channel', value: cfg.alert_channel_id ? `<#${cfg.alert_channel_id}>` : 'Not Set', inline: true },
        { name: 'Audit Log Channel', value: cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : 'Not Set', inline: true },
        { name: 'Fallback Review Channel', value: cfg.fallback_review_channel_id ? `<#${cfg.fallback_review_channel_id}>` : 'Not Set', inline: true },
        {
          name: 'Thresholds (At-Risk / Inactive / Escalation)',
          value: `${cfg.at_risk_hours}h / ${cfg.inactive_hours}h / ${cfg.escalation_hours}h`,
          inline: true,
        },
        {
          name: 'Scan Interval',
          value: `${cfg.scan_interval_minutes} minutes`,
          inline: true,
        },
        { name: 'Warning Expiry Days', value: `${cfg.warning_expiry_days}`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'register') {
      if (!isGlobalOwner && !isServerOwner) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: interaction.user.tag,
          guildId: ctx.guildId,
          actionDescription: '/server register',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }
      const updated = container.guildConfig.ensureGuildRegistered(
        ctx.guildId,
        interaction.guild.name,
        interaction.guild.ownerId,
      );
      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Server Registered`,
        tone: 'success',
        description: `**${updated.guild_name}** (\`${updated.guild_id}\`) is registered with TANVEER STAFF MONITOR.\n\nDiscord Server Owner: \`${updated.owner_id}\``,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'owner') {
      if (!isGlobalOwner) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: interaction.user.tag,
          guildId: ctx.guildId,
          actionDescription: '/server owner',
          requiredBy: 'GLOBAL_OWNER',
          audit: container.audit,
        });
      }
      const newOwnerId = interaction.options.getString('new_owner', false)?.trim();
      const cfg = container.guildConfig.getGuildConfigOrThrow(ctx.guildId);

      if (newOwnerId) {
        if (!/^\d{17,20}$/.test(newOwnerId)) {
          throw new Error('Invalid Discord User ID format.');
        }
        const updated = container.guildConfig.ensureGuildRegistered(ctx.guildId, interaction.guild.name, newOwnerId);
        const embed = createBrandEmbed({
          title: `${emojis.get('security')} Server Ownership Updated`,
          tone: 'success',
          description: `Server \`${ctx.guildId}\` ownership transferred to \`${newOwnerId}\`.\nPrevious owner: \`${cfg.owner_id}\``,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else {
        const embed = createBrandEmbed({
          title: `${emojis.get('owner')} Current Server Owner`,
          tone: 'cyan',
          description: `**Discord Server Owner:** \`${cfg.owner_id}\`\n**Guild:** ${cfg.guild_name} (\`${cfg.guild_id}\`)`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'leave') {
      if (!isGlobalOwner) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: interaction.user.tag,
          guildId: ctx.guildId,
          actionDescription: '/server leave',
          requiredBy: 'GLOBAL_OWNER',
          audit: container.audit,
        });
      }
      const targetGuildId = interaction.options.getString('guild_id', true).trim();
      if (targetGuildId === ctx.guildId) {
        throw new Error('Use the /server leave command from the target server, or use /owner guilds to manage cross-server.');
      }
      const guild = interaction.client.guilds.cache.get(targetGuildId);
      if (!guild) {
        throw new Error(`Guild \`${targetGuildId}\` not found or bot is not a member.`);
      }
      await guild.leave();
      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Bot Left Server`,
        tone: 'success',
        description: `The bot has left server \`${targetGuildId}\` (${guild.name}).`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'settings') {
      const perms = container.permissions.evaluateGuildPermissions(ctx);
      if (!perms.isGlobalOwner && !perms.isServerOwner) {
        assertAuthorizedOrDenied({
          actorUserId: actorId,
          actorTag: interaction.user.tag,
          guildId: ctx.guildId,
          actionDescription: '/server settings',
          requiredBy: 'GLOBAL_OR_SERVER_OWNER',
          audit: container.audit,
        });
      }
      const cfg = container.guildConfig.getGuildConfigOrThrow(ctx.guildId);
      const features = container.features.listGuildFeatures(ctx.guildId);
      const enabledCount = features.filter((f) => f.effectiveEnabled).length;
      const embed = createBrandEmbed({
        title: `${emojis.get('premium')} Server Settings — ${cfg.guild_name}`,
        tone: 'purple',
        subtitle: `Guild ID: ${cfg.guild_id}`,
      }).addFields(
        { name: 'Server Owner', value: `\`${cfg.owner_id}\``, inline: true },
        { name: 'Features Enabled', value: `${enabledCount}/${features.length}`, inline: true },
        { name: 'Scan Interval', value: `${cfg.scan_interval_minutes} min`, inline: true },
        { name: 'At-Risk / Inactive / Escalation', value: `${cfg.at_risk_hours}h / ${cfg.inactive_hours}h / ${cfg.escalation_hours}h`, inline: true },
        { name: 'Warning Expiry', value: `${cfg.warning_expiry_days} days`, inline: true },
        { name: 'Approval Policy Override', value: cfg.approval_policy_override ?? 'Global Default', inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  },
};
