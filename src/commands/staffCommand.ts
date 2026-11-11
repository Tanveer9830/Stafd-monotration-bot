import { AttachmentBuilder, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { COVERAGE_DISPLAY_LABELS, STATUS_DISPLAY_LABELS, StaffMonitoringStatus } from '../config/theme';
import { ServerManagementDashboard } from '../dashboards/ServerManagementDashboard';
import { ReportPeriodType } from '../services/AnalyticsService';
import { STAFF_ROLE_CATEGORIES, STAFF_ROLE_CATEGORY_LABELS, StaffRoleCategory } from '../types/domain';
import { buildActorGuildContextFromDiscord, collectLiveGuildTelemetry } from '../utils/discordContext';
import { attachBannerAsset, createBrandEmbed } from '../utils/embeds';
import { formatDiscordTimestamp, formatSecondsCompact } from '../utils/ids';
import { SlashCommandModule } from './types';

export const staffCommand: SlashCommandModule = {
  name: 'staff',
  data: new SlashCommandBuilder()
    .setName('staff')
    .setDescription('Complete staff roster monitoring, scanning, profiles, roles & analytics')
    .addSubcommand((sub) =>
      sub
        .setName('setup')
        .setDescription('Initialize server staff monitoring & open the Server Management Dashboard')
        .addRoleOption((opt) => opt.setName('initial_role').setDescription('Optional initial staff role to add'))
        .addStringOption((opt) =>
          opt
            .setName('category')
            .setDescription('Category for initial role')
            .addChoices(...STAFF_ROLE_CATEGORIES.map((c) => ({ name: STAFF_ROLE_CATEGORY_LABELS[c], value: c }))),
        ),
    )
    .addSubcommand((sub) => sub.setName('scan').setDescription('Run an immediate full staff roster scan'))
    .addSubcommand((sub) => sub.setName('list').setDescription('View the complete configured staff roster'))
    .addSubcommand((sub) => sub.setName('active').setDescription('List all currently 🟢 ACTIVE staff members'))
    .addSubcommand((sub) => sub.setName('inactive').setDescription('List all confirmed 🔴 INACTIVE staff members'))
    .addSubcommand((sub) => sub.setName('at-risk').setDescription('List all 🟡 AT RISK staff members'))
    .addSubcommand((sub) =>
      sub.setName('unknown').setDescription('List staff with ⚪ UNKNOWN, 🆕 NEW STAFF, or 🟠 INSUFFICIENT WORKLOAD status'),
    )
    .addSubcommand((sub) =>
      sub
        .setName('profile')
        .setDescription('Inspect a staff member profile, workload, speeds & warning standing')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('activity')
        .setDescription('Inspect recent qualifying work events for a staff member')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('history')
        .setDescription('Inspect historical role transitions, inactivity incidents & leave for a staff member')
        .addUserOption((opt) => opt.setName('user').setDescription('Staff member to inspect').setRequired(true)),
    )
    .addSubcommandGroup((group) =>
      group
        .setName('roles')
        .setDescription('Configure monitored staff roles and role-specific thresholds')
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add or update a monitored staff role')
            .addRoleOption((opt) => opt.setName('role').setDescription('Discord role to monitor').setRequired(true))
            .addStringOption((opt) =>
              opt
                .setName('category')
                .setDescription('Staff tier category')
                .setRequired(true)
                .addChoices(...STAFF_ROLE_CATEGORIES.map((c) => ({ name: STAFF_ROLE_CATEGORY_LABELS[c], value: c }))),
            )
            .addIntegerOption((opt) => opt.setName('at_risk_hours').setDescription('Optional custom At-Risk hours'))
            .addIntegerOption((opt) => opt.setName('inactive_hours').setDescription('Optional custom Inactive hours'))
            .addIntegerOption((opt) => opt.setName('escalation_hours').setDescription('Optional custom Escalation hours')),
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Stop monitoring a staff role (preserves historical staff records)')
            .addRoleOption((opt) => opt.setName('role').setDescription('Discord role to remove').setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('List all configured staff roles in this server')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('report')
        .setDescription('Generate a branded staff performance report (PNG, CSV, or PDF)')
        .addStringOption((opt) =>
          opt
            .setName('period')
            .setDescription('Report time window')
            .setRequired(false)
            .addChoices(
              { name: 'Daily (24h)', value: 'DAILY' },
              { name: 'Weekly (7d)', value: 'WEEKLY' },
              { name: 'Monthly (30d)', value: 'MONTHLY' },
              { name: 'Custom Date Range', value: 'CUSTOM' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('format')
            .setDescription('Export file format')
            .setRequired(false)
            .addChoices(
              { name: 'PNG Visual Chart Report', value: 'png' },
              { name: 'CSV Spreadsheet', value: 'csv' },
              { name: 'PDF Document', value: 'pdf' },
            ),
        )
        .addUserOption((opt) => opt.setName('user').setDescription('Optional individual staff member filter'))
        .addStringOption((opt) => opt.setName('from_date').setDescription('Start date for CUSTOM (YYYY-MM-DD)'))
        .addStringOption((opt) => opt.setName('to_date').setDescription('End date for CUSTOM (YYYY-MM-DD)')),
    )
    .addSubcommand((sub) =>
      sub.setName('analytics').setDescription('View fairness-adjusted server staff performance analytics'),
    )
    .addSubcommand((sub) =>
      sub.setName('coverage').setDescription('Inspect current staff & channel monitoring coverage'),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Staff commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(true);

    if (group === 'roles') {
      if (sub === 'add') {
        container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'STAFF_ROLES_ADD');
        const role = interaction.options.getRole('role', true);
        const category = interaction.options.getString('category', true) as StaffRoleCategory;
        const customAtRisk = interaction.options.getInteger('at_risk_hours', false);
        const customInactive = interaction.options.getInteger('inactive_hours', false);
        const customEscalation = interaction.options.getInteger('escalation_hours', false);

        const saved = container.roster.addOrUpdateStaffRole(ctx.guildId, ctx.userId, {
          roleId: role.id,
          roleName: role.name,
          category,
          customAtRiskHours: customAtRisk,
          customInactiveHours: customInactive,
          customEscalationHours: customEscalation,
        });

        const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
        const sync = container.roster.syncGuildRoster(ctx.guildId, telemetry.liveMembers);

        const embed = createBrandEmbed({
          title: `${emojis.get('success')} Staff Role Configured & Roster Synchronized`,
          tone: 'success',
          subtitle: interaction.guild.name,
          description:
            `Role <@&${saved.role_id}> (**${saved.role_name}**) is now monitored as **${STAFF_ROLE_CATEGORY_LABELS[saved.category]}**.\n` +
            `Active monitored staff roster size: **${sync.activeStaffCount}** (${sync.newlyRegistered.length} newly added).`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'remove') {
        container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'STAFF_ROLES_REMOVE');
        const role = interaction.options.getRole('role', true);
        const removed = container.roster.removeStaffRole(ctx.guildId, ctx.userId, role.id);
        const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
        container.roster.syncGuildRoster(ctx.guildId, telemetry.liveMembers);

        const embed = createBrandEmbed({
          title: removed ? `${emojis.get('success')} Staff Role Removed` : `${emojis.get('warning')} Role Not Monitored`,
          tone: removed ? 'success' : 'warning',
          description: removed
            ? `Stopped monitoring <@&${role.id}>. All historical staff records have been preserved.`
            : `Role <@&${role.id}> was not configured in the staff roster.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (sub === 'list') {
        container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_ROLES_LIST');
        const roles = container.roster.listStaffRoles(ctx.guildId);
        const embed = createBrandEmbed({
          title: `${emojis.get('security')} Configured Staff Roles (${roles.length})`,
          tone: 'purple',
          subtitle: interaction.guild.name,
          description:
            roles.length === 0
              ? 'No staff roles configured yet. Use `/staff roles add`.'
              : roles
                  .map(
                    (r) =>
                      `• <@&${r.role_id}> (**${r.role_name}**) — *${STAFF_ROLE_CATEGORY_LABELS[r.category]}*` +
                      (r.custom_inactive_hours ? ` [Inactive: ${r.custom_inactive_hours}h]` : ''),
                  )
                  .join('\n'),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    }

    if (sub === 'setup') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'STAFF_SETUP');
      const initialRole = interaction.options.getRole('initial_role', false);
      const category = (interaction.options.getString('category', false) as StaffRoleCategory | null) ?? 'STAFF';

      if (initialRole) {
        container.roster.addOrUpdateStaffRole(ctx.guildId, ctx.userId, {
          roleId: initialRole.id,
          roleName: initialRole.name,
          category,
        });
      }

      const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
      container.roster.syncGuildRoster(ctx.guildId, telemetry.liveMembers);

      const dashboard = new ServerManagementDashboard(container);
      const payload = dashboard.render(ctx, 'overview', 0);
      await interaction.reply({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'scan') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'STAFF_SCAN');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
      const report = await container.scanner.scanGuildRoster(ctx.guildId, {
        trigger: 'MANUAL',
        actorUserId: ctx.userId,
        liveMembers: telemetry.liveMembers,
        livePermissionChecks: telemetry.livePermissionChecks,
        roleHoldersMap: telemetry.roleHoldersMap,
      });

      const allowAnimated = container.features.isEnabled(ctx.guildId, 'animated_assets');
      const embed = createBrandEmbed({
        title: `${emojis.get('scanning', { allowAnimated })} Full Roster Scan Completed`,
        tone: 'primary',
        subtitle: interaction.guild.name,
        description: report.skippedByLock
          ? 'Another scan is currently executing for this server; duplicate run safely prevented.'
          : `Scanned **${report.totalStaffScanned}** configured staff members under **${COVERAGE_DISPLAY_LABELS[report.coverageLevel]}** coverage.`,
      }).addFields(
        { name: '🟢 ACTIVE', value: `${report.statusCounts.ACTIVE}`, inline: true },
        { name: '🟡 AT RISK', value: `${report.statusCounts.AT_RISK}`, inline: true },
        { name: '🔴 INACTIVE', value: `${report.statusCounts.INACTIVE}`, inline: true },
        { name: '🔵 ON LEAVE', value: `${report.statusCounts.ON_LEAVE}`, inline: true },
        { name: '🟠 INSUFFICIENT WORKLOAD', value: `${report.statusCounts.INSUFFICIENT_WORKLOAD}`, inline: true },
        { name: '🆕 NEW / ⚪ UNKNOWN', value: `${report.statusCounts.NEW_STAFF} / ${report.statusCounts.UNKNOWN}`, inline: true },
        {
          name: 'Incidents & Reviews',
          value: `Incidents Updated: **${report.incidentsCreatedOrUpdated}** | Escalations: **${report.escalationsTriggered}** | Reviews Created: **${report.reviewsCreated}** | Auto-Cancelled: **${report.reviewsCancelled}**`,
          inline: false,
        },
      );

      const files: AttachmentBuilder[] = [];
      const banner = attachBannerAsset(embed, 'staff-scanning', allowAnimated);
      if (banner) files.push(banner);

      await interaction.editReply({ embeds: [embed], files });
      return;
    }

    if (sub === 'list' || sub === 'active' || sub === 'inactive' || sub === 'at-risk' || sub === 'unknown') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', `STAFF_${sub.toUpperCase()}`);
      const all = container.roster.listStaffProfiles(ctx.guildId, { onlyActiveStaff: true });

      const statusFilterMap: Record<string, StaffMonitoringStatus[]> = {
        list: [
          'ACTIVE',
          'AT_RISK',
          'INACTIVE',
          'ON_LEAVE',
          'UNKNOWN',
          'NEW_STAFF',
          'INSUFFICIENT_WORKLOAD',
          'MONITORING_ERROR',
        ],
        active: ['ACTIVE'],
        inactive: ['INACTIVE'],
        'at-risk': ['AT_RISK'],
        unknown: ['UNKNOWN', 'NEW_STAFF', 'INSUFFICIENT_WORKLOAD', 'MONITORING_ERROR'],
      };

      const allowedStatuses = new Set(statusFilterMap[sub]);
      const filtered = all.filter((s) => allowedStatuses.has(s.monitoring_status));

      const embed = createBrandEmbed({
        title: `${emojis.get('scanning')} Staff Roster — ${sub.toUpperCase()} (${filtered.length})`,
        tone: sub === 'inactive' ? 'danger' : sub === 'at-risk' ? 'warning' : 'purple',
        subtitle: interaction.guild.name,
        description:
          filtered.length === 0
            ? 'No configured staff members match this status filter.'
            : filtered
                .slice(0, 20)
                .map(
                  (s) =>
                    `• **${s.display_name}** (@${s.username} | \`${s.user_id}\`) — ${STATUS_DISPLAY_LABELS[s.monitoring_status]} | Last Work: ${formatDiscordTimestamp(s.last_qualifying_work_at)}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'profile') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_PROFILE');
      const targetUser = interaction.options.getUser('user', true);
      const profile = container.roster.getStaffProfile(ctx.guildId, targetUser.id);
      if (!profile) {
        throw new Error(`User <@${targetUser.id}> does not have a staff profile in this server.`);
      }

      const activeLeave = container.leave.getActiveLeaveForStaff(ctx.guildId, targetUser.id);
      const embed = createBrandEmbed({
        title: `${emojis.get('performance')} Staff Profile — ${profile.display_name}`,
        tone: 'cyan',
        subtitle: `${interaction.guild.name} • ${profile.is_currently_staff ? 'Current Staff' : 'Historical Staff Record'}`,
      }).addFields(
        { name: 'Discord ID', value: `\`${profile.user_id}\``, inline: true },
        { name: 'Primary Tier', value: STAFF_ROLE_CATEGORY_LABELS[profile.primary_category], inline: true },
        { name: 'Monitoring Status', value: STATUS_DISPLAY_LABELS[profile.monitoring_status], inline: true },
        { name: 'Last Qualifying Work', value: formatDiscordTimestamp(profile.last_qualifying_work_at), inline: true },
        { name: 'Last Ticket Activity', value: formatDiscordTimestamp(profile.last_ticket_activity_at), inline: true },
        { name: 'Coverage', value: COVERAGE_DISPLAY_LABELS[profile.monitoring_coverage], inline: true },
        {
          name: 'Ticket Workload & Output',
          value: `Assigned: **${profile.assigned_tickets_count}** | Handled: **${profile.tickets_handled_count}** | Resolved: **${profile.tickets_resolved_count}** | Open Workload: **${profile.current_workload}**`,
          inline: false,
        },
        {
          name: 'Response & Resolution Speeds',
          value: `Avg 1st Response: **${formatSecondsCompact(profile.avg_first_response_sec)}** | Avg Resolution: **${formatSecondsCompact(profile.avg_resolution_sec)}**`,
          inline: true,
        },
        {
          name: 'Warnings & Leave',
          value: `Active Warnings: **${profile.active_warnings_count}/3** (Total: ${profile.total_warnings_count})\nLeave: ${activeLeave ? `Active until ${activeLeave.end_at.slice(0, 10)}` : 'None Active'}`,
          inline: true,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'activity') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_ACTIVITY');
      const targetUser = interaction.options.getUser('user', true);
      const events = container.classifier.listStaffActivityEvents(ctx.guildId, targetUser.id, {
        onlyQualifying: true,
        limit: 12,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('active')} Qualifying Activity Evidence — ${targetUser.username}`,
        tone: 'success',
        subtitle: interaction.guild.name,
        description:
          events.length === 0
            ? 'No qualifying work events recorded for this staff member.'
            : events
                .map(
                  (e) =>
                    `• \`${e.event_type}\` ${formatDiscordTimestamp(e.occurred_at)} — ${e.classification_reason}` +
                    (e.channel_id ? ` (<#${e.channel_id}>)` : ''),
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'history') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_HISTORY');
      const targetUser = interaction.options.getUser('user', true);
      const roleHist = container.roster.getRoleHistory(ctx.guildId, targetUser.id, 6);
      const leaves = container.leave.listGuildLeave(ctx.guildId, { staffUserId: targetUser.id, limit: 5 });
      const warns = container.warnings.listWarnings(ctx.guildId, { staffUserId: targetUser.id, limit: 5 });

      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Historical Record — ${targetUser.username}`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
      }).addFields(
        {
          name: 'Role & Membership Transitions',
          value:
            roleHist.length === 0
              ? 'No transitions recorded.'
              : roleHist.map((r) => `• \`${r.change_type}\` (${formatDiscordTimestamp(r.detected_at)})`).join('\n'),
          inline: false,
        },
        {
          name: 'Warning History',
          value:
            warns.length === 0
              ? 'Clean record (0 warnings).'
              : warns.map((w) => `• \`${w.warning_id}\` Level ${w.warning_level}/3 [\`${w.status}\`] — ${w.reason}`).join('\n'),
          inline: false,
        },
        {
          name: 'Leave History',
          value:
            leaves.length === 0
              ? 'No leave records.'
              : leaves.map((l) => `• \`${l.leave_id}\` [\`${l.status}\`] ${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)}`).join('\n'),
          inline: false,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'report') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_REPORT');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const period = (interaction.options.getString('period', false) as ReportPeriodType | null) ?? 'WEEKLY';
      const fmt = interaction.options.getString('format', false) ?? 'png';
      const filterUser = interaction.options.getUser('user', false);
      const fromDate = interaction.options.getString('from_date', false) ?? undefined;
      const toDate = interaction.options.getString('to_date', false) ?? undefined;

      const report = container.analytics.buildGuildAnalytics(ctx.guildId, {
        periodType: period,
        customFromIso: fromDate,
        customToIso: toDate,
        targetStaffUserId: filterUser?.id,
      });

      const files: AttachmentBuilder[] = [];
      if (fmt === 'png') {
        const buf = container.reportExporter.exportGuildPngReport(report);
        files.push(new AttachmentBuilder(buf, { name: `tanveer-staff-report-${period.toLowerCase()}.png` }));
      } else if (fmt === 'csv') {
        const buf = container.reportExporter.exportGuildCsvReport(report);
        files.push(new AttachmentBuilder(buf, { name: `tanveer-staff-report-${period.toLowerCase()}.csv` }));
      } else {
        const buf = await container.reportExporter.exportGuildPdfReport(report);
        files.push(new AttachmentBuilder(buf, { name: `tanveer-staff-report-${period.toLowerCase()}.pdf` }));
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} ${period} Staff Performance Report Generated`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: `Exported verified database metrics in **${fmt.toUpperCase()}** format (${report.fromIso.slice(0, 10)} → ${report.toIso.slice(0, 10)}).`,
      });
      await interaction.editReply({ embeds: [embed], files });
      return;
    }

    if (sub === 'analytics') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_ANALYTICS');
      const report = container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: 'WEEKLY' });
      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Fairness-Adjusted Staff Performance Analytics`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description:
          `Window: **${report.fromIso.slice(0, 10)} → ${report.toIso.slice(0, 10)}** | Coverage: ${COVERAGE_DISPLAY_LABELS[report.coverageLevel]}\n` +
          `Available Workload Opportunities: **${report.ticketMetrics.availableWorkload}**`,
      }).addFields({
        name: 'Staff Consistency & Output',
        value:
          report.staffRows.length === 0
            ? 'No configured staff profiles yet.'
            : report.staffRows
                .slice(0, 10)
                .map(
                  (r) =>
                    `• **${r.username}** — ${STATUS_DISPLAY_LABELS[r.monitoringStatus]} | Handled: **${r.ticketsHandled}** | Consistency: **${r.workConsistencyPct}%** | *${r.fairnessNote}*`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'coverage') {
      container.permissions.assertGuildCapability(ctx, 'canViewReports', 'STAFF_COVERAGE');
      const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
      const diag = container.tickets.runDiagnostics(
        ctx.guildId,
        telemetry.livePermissionChecks,
        container.config.enableMessageContentIntent,
      );

      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Monitoring Coverage Verification`,
        tone: diag.coverageLevel === 'FULL' ? 'success' : diag.coverageLevel === 'PARTIAL' ? 'warning' : 'danger',
        subtitle: interaction.guild.name,
        description:
          `**Overall Coverage:** ${COVERAGE_DISPLAY_LABELS[diag.coverageLevel]}\n` +
          `**Accessible Channels/Categories:** ${diag.accessibleCount}\n` +
          `**Inaccessible / Missing:** ${diag.inaccessibleCount}\n\n` +
          `*Safety Rule:* Formal inactivity warning reviews are strictly blocked whenever coverage is below FULL.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
