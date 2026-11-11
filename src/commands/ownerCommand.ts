import { AttachmentBuilder, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { GlobalOwnerDashboard } from '../dashboards/GlobalOwnerDashboard';
import { ALL_FEATURE_KEYS, BotAdminScope, FEATURE_LABELS, FeatureKey } from '../types/domain';
import { createBrandEmbed } from '../utils/embeds';
import { SlashCommandModule } from './types';

export const ownerCommand: SlashCommandModule = {
  name: 'owner',
  data: new SlashCommandBuilder()
    .setName('owner')
    .setDescription('Permanent Global Owner management & cross-server telemetry commands')
    .addSubcommand((sub) =>
      sub.setName('panel').setDescription('Open the interactive Global Owner Command Center'),
    )
    .addSubcommandGroup((group) =>
      group
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
                .setDescription('Comma-separated scopes (VIEW_GLOBAL_STATS,VIEW_GUILDS,INSPECT_DIAGNOSTICS,VIEW_AUDIT_LOGS)')
                .setRequired(false),
            )
            .addStringOption((opt) => opt.setName('notes').setDescription('Appointment notes').setRequired(false)),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Revoke an authorized bot administrator (Global Owner only)')
            .addUserOption((opt) => opt.setName('user').setDescription('Bot administrator to revoke').setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List all authorized bot administrators')),
    )
    .addSubcommand((sub) => sub.setName('guilds').setDescription('List all registered Discord servers'))
    .addSubcommand((sub) =>
      sub
        .setName('guild-info')
        .setDescription('Inspect configuration, health & metrics of a registered server')
        .addStringOption((opt) => opt.setName('guild_id').setDescription('Target Discord Server ID').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('features')
        .setDescription('Configure global feature locks across all servers (Global Owner only)')
        .addStringOption((opt) =>
          opt
            .setName('feature')
            .setDescription('Feature key to allow or globally restrict')
            .setRequired(false)
            .addChoices(...ALL_FEATURE_KEYS.map((k) => ({ name: `${FEATURE_LABELS[k]} (${k})`, value: k }))),
        )
        .addBooleanOption((opt) =>
          opt.setName('allowed').setDescription('True = Allowed locally, False = Globally locked').setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('global-stats')
        .setDescription('View cross-server statistics and optionally export PNG/CSV/PDF')
        .addStringOption((opt) =>
          opt
            .setName('export')
            .setDescription('Optional report export format')
            .setRequired(false)
            .addChoices(
              { name: 'PNG Visual Report', value: 'png' },
              { name: 'CSV Data Export', value: 'csv' },
              { name: 'PDF Executive Report', value: 'pdf' },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('audit')
        .setDescription('Inspect global security & management audit logs')
        .addStringOption((opt) => opt.setName('guild_id').setDescription('Optional Guild ID filter').setRequired(false))
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Rows to display (1-25)').setRequired(false)),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    const actorId = interaction.user.id;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    if (group === 'admin') {
      container.permissions.assertGlobalOwner(actorId, `OWNER_ADMIN_${sub.toUpperCase()}`, interaction.guildId);

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
          ? rawScopes
              .split(',')
              .map((s) => s.trim().toUpperCase() as BotAdminScope)
              .filter((s) => validScopes.includes(s))
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
    }

    if (sub === 'panel') {
      const dashboard = new GlobalOwnerDashboard(container);
      const payload = dashboard.render(actorId, 'overview', 0);
      await interaction.reply({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'guilds') {
      if (!container.permissions.hasBotAdminScope(actorId, 'VIEW_GUILDS')) {
        container.permissions.assertGlobalOwner(actorId, 'OWNER_GUILDS', interaction.guildId);
      }
      const guilds = container.guildConfig.listAllGuilds();
      const embed = createBrandEmbed({
        title: `${emojis.get('owner')} Registered Discord Servers (${guilds.length})`,
        tone: 'purple',
        description:
          guilds.length === 0
            ? 'No registered Discord servers.'
            : guilds
                .slice(0, 20)
                .map(
                  (g) =>
                    `• **${g.guild_name}** (\`${g.guild_id}\`) — Owner: \`${g.owner_id}\` | Thresholds: ${g.at_risk_hours}h/${g.inactive_hours}h/${g.escalation_hours}h`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'guild-info') {
      if (!container.permissions.hasBotAdminScope(actorId, 'INSPECT_DIAGNOSTICS')) {
        container.permissions.assertGlobalOwner(actorId, 'OWNER_GUILD_INFO', interaction.guildId);
      }
      const targetGuildId = interaction.options.getString('guild_id', true).trim();
      const cfg = container.guildConfig.getGuildConfigOrThrow(targetGuildId);
      const staff = container.roster.listStaffProfiles(targetGuildId, { onlyActiveStaff: true });
      const tSummary = container.tickets.getGuildTicketSummary(targetGuildId);
      const diag = container.tickets.runDiagnostics(targetGuildId);
      const pendingRevs = container.reviews.listGuildReviews(targetGuildId, { pendingOnly: true });

      const embed = createBrandEmbed({
        title: `${emojis.get('owner')} Server Diagnostic Inspection — ${cfg.guild_name}`,
        tone: 'cyan',
        subtitle: `Server ID: ${cfg.guild_id}`,
      }).addFields(
        { name: 'Discord Server Owner', value: `\`${cfg.owner_id}\``, inline: true },
        { name: 'Monitored Staff', value: `${staff.length}`, inline: true },
        { name: 'Coverage Level', value: diag.coverageLevel, inline: true },
        {
          name: 'Thresholds (Risk / Inact / Esc)',
          value: `${cfg.at_risk_hours}h / ${cfg.inactive_hours}h / ${cfg.escalation_hours}h`,
          inline: true,
        },
        {
          name: 'Tickets Total / Resolved',
          value: `${tSummary.totalTickets} / ${tSummary.resolvedTickets + tSummary.closedTickets}`,
          inline: true,
        },
        { name: 'Pending Warning Reviews', value: `${pendingRevs.length}`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'features') {
      container.permissions.assertGlobalOwner(actorId, 'OWNER_FEATURES', interaction.guildId);
      const feature = interaction.options.getString('feature', false) as FeatureKey | null;
      const allowed = interaction.options.getBoolean('allowed', false);

      if (feature && allowed !== null) {
        container.features.setGlobalFeatureRestriction(actorId, feature, allowed);
      }

      const disabled = container.features.getGloballyDisabledFeatures();
      const embed = createBrandEmbed({
        title: `${emojis.get('premium')} Global Feature Restrictions`,
        tone: 'purple',
        description: ALL_FEATURE_KEYS.map(
          (k) => `${disabled.has(k) ? '🔒 **LOCKED OFF**' : '🟢 **ALLOWED**'} — \`${k}\` (${FEATURE_LABELS[k]})`,
        ).join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'global-stats') {
      const hasStatsScope = container.permissions.hasBotAdminScope(actorId, 'VIEW_GLOBAL_STATS');
      if (!hasStatsScope) {
        container.permissions.assertGlobalOwner(actorId, 'OWNER_GLOBAL_STATS', interaction.guildId);
      }
      const report = container.analytics.buildGlobalAnalytics(actorId, hasStatsScope);
      const exportFmt = interaction.options.getString('export', false);
      const files: AttachmentBuilder[] = [];

      if (exportFmt === 'png') {
        const buf = container.reportExporter.exportGlobalPngReport(report);
        files.push(new AttachmentBuilder(buf, { name: 'tanveer-global-report.png' }));
      } else if (exportFmt === 'csv') {
        const buf = container.reportExporter.exportGlobalCsvReport(report);
        files.push(new AttachmentBuilder(buf, { name: 'tanveer-global-report.csv' }));
      } else if (exportFmt === 'pdf') {
        const buf = await container.reportExporter.exportGlobalPdfReport(report);
        files.push(new AttachmentBuilder(buf, { name: 'tanveer-global-report.pdf' }));
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Global Platform Telemetry`,
        tone: 'primary',
      }).addFields(
        { name: 'Registered Servers', value: `${report.totalGuilds}`, inline: true },
        { name: 'Configured Staff', value: `${report.totalStaff}`, inline: true },
        { name: 'Active / At-Risk / Inactive', value: `${report.statusBreakdown.ACTIVE} / ${report.statusBreakdown.AT_RISK} / ${report.statusBreakdown.INACTIVE}`, inline: true },
        { name: 'Tickets Monitored / Handled', value: `${report.totalTicketsMonitored} / ${report.totalTicketsHandled}`, inline: true },
        { name: 'Pending Reviews', value: `${report.pendingReviews}`, inline: true },
        { name: 'Total Warnings', value: `${report.totalWarnings}`, inline: true },
      );

      await interaction.reply({ embeds: [embed], files, flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'audit') {
      const hasAuditScope = container.permissions.hasBotAdminScope(actorId, 'VIEW_AUDIT_LOGS');
      if (!hasAuditScope) {
        container.permissions.assertGlobalOwner(actorId, 'OWNER_AUDIT', interaction.guildId);
      }
      const filterGuild = interaction.options.getString('guild_id', false) ?? undefined;
      const limit = Math.min(25, Math.max(1, interaction.options.getInteger('limit', false) ?? 12));
      const logs = container.audit.listGlobalLogs(actorId, hasAuditScope, { guildId: filterGuild, limit });

      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Global Audit Logs (${logs.length})`,
        tone: 'midnight',
        description:
          logs.length === 0
            ? 'No matching audit log entries.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — Actor \`${l.actor_user_id}\` (${l.guild_id ?? 'GLOBAL'}) at ${l.created_at}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
