import { AttachmentBuilder, ChannelType, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { COVERAGE_DISPLAY_LABELS } from '../config/theme';
import { ReportPeriodType } from '../services/AnalyticsService';
import { buildActorGuildContextFromDiscord, collectLiveGuildTelemetry } from '../utils/discordContext';
import { attachBannerAsset, createBrandEmbed } from '../utils/embeds';
import { formatSecondsCompact } from '../utils/ids';
import { SlashCommandModule } from './types';

export const ticketCommand: SlashCommandModule = {
  name: 'ticket',
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Complete ticket workload monitoring, adapters & diagnostics')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Configure primary ticket category or parent channel and adapter engine')
        .addChannelOption((opt) =>
          opt
            .setName('target')
            .setDescription('Ticket category or channel to monitor')
            .addChannelTypes(ChannelType.GuildCategory, ChannelType.GuildText, ChannelType.GuildForum)
            .setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName('adapter')
            .setDescription('Ticket system adapter')
            .setRequired(false)
            .addChoices(
              { name: 'Generic Discord Ticket Engine', value: 'generic' },
              { name: 'Ticket Tool Adapter', value: 'ticket-tool' },
              { name: 'Tickets v2 Adapter', value: 'tickets-v2' },
              { name: 'Custom Pattern Adapter', value: 'custom' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('channels')
        .setDescription('Add, remove, or list monitored ticket channels / thread parents')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Channel configuration action')
            .setRequired(true)
            .addChoices(
              { name: 'List Configured Channels', value: 'list' },
              { name: 'Add Ticket Channel', value: 'add_channel' },
              { name: 'Add Thread Parent Channel', value: 'add_thread_parent' },
              { name: 'Remove Channel', value: 'remove' },
            ),
        )
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Target text channel (required for add/remove)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildForum),
        )
        .addStringOption((opt) =>
          opt
            .setName('adapter')
            .setDescription('Adapter type')
            .addChoices(
              { name: 'Generic', value: 'generic' },
              { name: 'Ticket Tool', value: 'ticket-tool' },
              { name: 'Tickets v2', value: 'tickets-v2' },
              { name: 'Custom', value: 'custom' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('categories')
        .setDescription('Add, remove, or list monitored ticket categories')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Category configuration action')
            .setRequired(true)
            .addChoices(
              { name: 'List Configured Categories', value: 'list' },
              { name: 'Add Ticket Category', value: 'add' },
              { name: 'Remove Ticket Category', value: 'remove' },
            ),
        )
        .addChannelOption((opt) =>
          opt
            .setName('category')
            .setDescription('Target Discord category (required for add/remove)')
            .addChannelTypes(ChannelType.GuildCategory),
        )
        .addStringOption((opt) =>
          opt
            .setName('adapter')
            .setDescription('Adapter type')
            .addChoices(
              { name: 'Generic', value: 'generic' },
              { name: 'Ticket Tool', value: 'ticket-tool' },
              { name: 'Tickets v2', value: 'tickets-v2' },
              { name: 'Custom', value: 'custom' },
            ),
        ),
    )
    .addSubcommand((sub) => sub.setName('status').setDescription('Inspect live open & active ticket queue status'))
    .addSubcommand((sub) => sub.setName('stats').setDescription('View server-wide ticket lifecycle & speed statistics'))
    .addSubcommand((sub) =>
      sub
        .setName('staff')
        .setDescription('View ticket handling, workload & response speeds for a staff member or full team')
        .addUserOption((opt) => opt.setName('user').setDescription('Optional specific staff member')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('report')
        .setDescription('Export a branded ticket analytics report (PNG, CSV, or PDF)')
        .addStringOption((opt) =>
          opt
            .setName('format')
            .setDescription('Export file format')
            .setRequired(false)
            .addChoices(
              { name: 'PNG Visual Chart', value: 'png' },
              { name: 'CSV Data File', value: 'csv' },
              { name: 'PDF Document', value: 'pdf' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('period')
            .setDescription('Report window')
            .setRequired(false)
            .addChoices(
              { name: 'Daily', value: 'DAILY' },
              { name: 'Weekly', value: 'WEEKLY' },
              { name: 'Monthly', value: 'MONTHLY' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('diagnose')
        .setDescription('Run complete ticket permissions, coverage & adapter capability diagnostics'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Ticket commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'setup') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'TICKET_SETUP');
      const target = interaction.options.getChannel('target', true);
      const adapterType = interaction.options.getString('adapter', false) ?? 'generic';
      const targetType = target.type === ChannelType.GuildCategory ? 'CATEGORY' : 'CHANNEL';

      const { record, adapterWarning } = container.tickets.addTicketChannelConfig(ctx.guildId, ctx.userId, {
        targetType,
        channelId: target.id,
        channelName: target.name ?? target.id,
        adapterType,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Ticket Monitoring Configured`,
        tone: 'success',
        subtitle: interaction.guild.name,
        description:
          `Configured **${record.target_type}** \`${record.channel_name}\` (\`${record.channel_id}\`) using adapter \`${record.adapter_type}\`.\n` +
          (adapterWarning ? `\n⚠️ ${adapterWarning}` : ''),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'channels') {
      const action = interaction.options.getString('action', true);
      if (action === 'list') {
        container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_CHANNELS_LIST');
        const list = container.tickets
          .listTicketChannelConfigs(ctx.guildId)
          .filter((c) => c.target_type !== 'CATEGORY');
        const embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Configured Ticket Channels (${list.length})`,
          tone: 'cyan',
          description:
            list.length === 0
              ? 'No direct ticket channels or thread parents configured.'
              : list.map((c) => `• <#${c.channel_id}> (\`${c.target_type}\`) — Adapter: \`${c.adapter_type}\``).join('\n'),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'TICKET_CHANNELS_MODIFY');
      const channel = interaction.options.getChannel('channel', false);
      if (!channel) {
        throw new Error('Please provide a target `channel` option for add/remove actions.');
      }

      if (action === 'remove') {
        const removed = container.tickets.removeTicketChannelConfig(ctx.guildId, ctx.userId, channel.id);
        const embed = createBrandEmbed({
          title: removed ? `${emojis.get('success')} Ticket Channel Removed` : `${emojis.get('warning')} Not Found`,
          tone: removed ? 'success' : 'warning',
          description: removed
            ? `Removed <#${channel.id}> from ticket monitoring.`
            : `<#${channel.id}> was not configured.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      const adapter = interaction.options.getString('adapter', false) ?? 'generic';
      const targetType = action === 'add_thread_parent' ? 'THREAD_PARENT' : 'CHANNEL';
      const { record } = container.tickets.addTicketChannelConfig(ctx.guildId, ctx.userId, {
        targetType,
        channelId: channel.id,
        channelName: channel.name ?? channel.id,
        adapterType: adapter,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Ticket Channel Added`,
        tone: 'success',
        description: `Registered <#${record.channel_id}> as \`${record.target_type}\` with adapter \`${record.adapter_type}\`.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'categories') {
      const action = interaction.options.getString('action', true);
      if (action === 'list') {
        container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_CATEGORIES_LIST');
        const list = container.tickets.listTicketChannelConfigs(ctx.guildId, 'CATEGORY');
        const embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Configured Ticket Categories (${list.length})`,
          tone: 'cyan',
          description:
            list.length === 0
              ? 'No ticket categories configured.'
              : list.map((c) => `• **${c.channel_name}** (\`${c.channel_id}\`) — Adapter: \`${c.adapter_type}\``).join('\n'),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'TICKET_CATEGORIES_MODIFY');
      const category = interaction.options.getChannel('category', false);
      if (!category) {
        throw new Error('Please provide a target `category` option for add/remove actions.');
      }

      if (action === 'remove') {
        const removed = container.tickets.removeTicketChannelConfig(ctx.guildId, ctx.userId, category.id);
        const embed = createBrandEmbed({
          title: removed ? `${emojis.get('success')} Category Removed` : `${emojis.get('warning')} Not Found`,
          tone: removed ? 'success' : 'warning',
          description: removed
            ? `Removed category **${category.name}** (\`${category.id}\`).`
            : `Category \`${category.id}\` was not configured.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      const adapter = interaction.options.getString('adapter', false) ?? 'generic';
      const { record } = container.tickets.addTicketChannelConfig(ctx.guildId, ctx.userId, {
        targetType: 'CATEGORY',
        channelId: category.id,
        channelName: category.name ?? category.id,
        adapterType: adapter,
      });
      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Ticket Category Configured`,
        tone: 'success',
        description: `All tickets inside **${record.channel_name}** (\`${record.channel_id}\`) will be monitored via \`${record.adapter_type}\`.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'status') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_STATUS');
      const summary = container.tickets.getGuildTicketSummary(ctx.guildId);
      const recent = container.tickets.listRecentTickets(ctx.guildId, 10);
      const allowAnimated = container.features.isEnabled(ctx.guildId, 'animated_assets');

      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Live Ticket Queue Status`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          `**Open:** ${summary.openTickets} | **Active / Claimed:** ${summary.inProgressTickets} | **Resolved / Closed:** ${summary.resolvedTickets + summary.closedTickets}\n\n` +
          (recent.length === 0
            ? 'No tickets observed yet.'
            : recent
                .map(
                  (t) =>
                    `• \`${t.ticket_id}\` (#${t.channel_name}) — \`${t.status}\` | Assignee: ${t.assigned_to_user_id ? `<@${t.assigned_to_user_id}>` : 'Unassigned'}`,
                )
                .join('\n')),
      });
      const files: AttachmentBuilder[] = [];
      const banner = attachBannerAsset(embed, 'ticket-monitoring', allowAnimated);
      if (banner) files.push(banner);
      await interaction.reply({ embeds: [embed], files, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'stats') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_STATS');
      const s = container.tickets.getGuildTicketSummary(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Server Ticket Statistics`,
        tone: 'purple',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Total Monitored', value: `${s.totalTickets}`, inline: true },
        { name: 'Open / Active', value: `${s.openTickets} / ${s.inProgressTickets}`, inline: true },
        { name: 'Resolved / Closed', value: `${s.resolvedTickets} / ${s.closedTickets}`, inline: true },
        { name: 'Reopened Count', value: `${s.reopenedTickets}`, inline: true },
        { name: 'Avg First Response', value: formatSecondsCompact(s.avgFirstResponseSec), inline: true },
        { name: 'Avg Resolution Time', value: formatSecondsCompact(s.avgResolutionSec), inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'staff') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_STAFF');
      const filterUser = interaction.options.getUser('user', false);
      const profiles = container.roster
        .listStaffProfiles(ctx.guildId, { onlyActiveStaff: true })
        .filter((p) => !filterUser || p.user_id === filterUser.id);

      const embed = createBrandEmbed({
        title: `${emojis.get('performance')} Staff Ticket Workload & Output`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
        description:
          profiles.length === 0
            ? 'No matching monitored staff profiles.'
            : profiles
                .slice(0, 15)
                .map(
                  (p) =>
                    `• **${p.display_name}** (\`${p.user_id}\`) — Assigned: **${p.assigned_tickets_count}** | Handled: **${p.tickets_handled_count}** | Resolved: **${p.tickets_resolved_count}** | Open Workload: **${p.current_workload}** | 1st Resp: **${formatSecondsCompact(p.avg_first_response_sec)}**`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'report') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_REPORT');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const fmt = interaction.options.getString('format', false) ?? 'png';
      const period = (interaction.options.getString('period', false) as ReportPeriodType | null) ?? 'WEEKLY';
      const report = container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: period });

      const files: AttachmentBuilder[] = [];
      if (fmt === 'png') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGuildPngReport(report), { name: 'tanveer-ticket-report.png' }));
      } else if (fmt === 'csv') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGuildCsvReport(report), { name: 'tanveer-ticket-report.csv' }));
      } else {
        files.push(new AttachmentBuilder(await container.reportExporter.exportGuildPdfReport(report), { name: 'tanveer-ticket-report.pdf' }));
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('tickets')} Ticket Workload & Performance Report (${period})`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Generated verified **${fmt.toUpperCase()}** ticket report.`,
      });
      await interaction.editReply({ embeds: [embed], files });
      return;
    }

    if (sub === 'diagnose') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'TICKET_DIAGNOSE');
      const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
      const diag = container.tickets.runDiagnostics(
        ctx.guildId,
        telemetry.livePermissionChecks,
        container.config.enableMessageContentIntent,
      );

      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Ticket Engine & Adapter Diagnostics`,
        tone: diag.coverageLevel === 'FULL' ? 'success' : 'warning',
        subtitle: interaction.guild.name,
        description:
          `**Monitoring Coverage:** ${COVERAGE_DISPLAY_LABELS[diag.coverageLevel]}\n` +
          `**Accessible Targets:** ${diag.accessibleCount} | **Inaccessible/Missing:** ${diag.inaccessibleCount}`,
      });

      for (const rep of diag.adapterReports) {
        embed.addFields({
          name: `${rep.adapterName} (\`${rep.adapterId}\`) — ${rep.healthy ? '🟢 Healthy' : '🟡 Degraded'}`,
          value:
            `**Supported Events:** ${rep.supportedEvents.map((e) => `\`${e}\``).join(', ')}\n` +
            (rep.missingPermissions.length > 0
              ? `**Missing Permissions:**\n${rep.missingPermissions.map((m) => `• ${m}`).join('\n')}\n`
              : '') +
            `**Observable Boundaries:**\n${rep.observableLimitations.map((l) => `• ${l}`).join('\n')}`,
          inline: false,
        });
      }

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
