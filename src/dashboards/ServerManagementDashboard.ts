import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { COVERAGE_DISPLAY_LABELS, renderProgressBar, STATUS_DISPLAY_LABELS } from '../config/theme';
import { STAFF_ROLE_CATEGORY_LABELS } from '../types/domain';
import { ActorGuildContext } from '../services/PermissionService';
import { attachBannerAsset, createBrandEmbed } from '../utils/embeds';
import { formatDiscordTimestamp, formatSecondsCompact } from '../utils/ids';
import { DashboardRenderPayload } from './GlobalOwnerDashboard';

export const SERVER_DASHBOARD_SECTIONS = [
  'overview',
  'roster',
  'profiles',
  'activity',
  'tickets',
  'inactivity',
  'warnings',
  'approvals',
  'leave',
  'analytics',
  'reports',
  'channels',
  'roles',
  'features',
  'health',
] as const;

export type ServerDashboardSection = (typeof SERVER_DASHBOARD_SECTIONS)[number];

const SERVER_SECTION_META: Readonly<
  Record<
    ServerDashboardSection,
    {
      label: string;
      description: string;
      requiredCap: 'canViewReports' | 'canApproveWarnings' | 'canManageLeave' | 'canConfigureGuild';
    }
  >
> = {
  overview: { label: 'Overview', description: 'Server telemetry & active workload summary', requiredCap: 'canViewReports' },
  roster: { label: 'Staff Roster', description: 'Complete configured staff roster & statuses', requiredCap: 'canViewReports' },
  profiles: { label: 'Staff Profiles', description: 'Individual staff profile cards & metrics', requiredCap: 'canViewReports' },
  activity: { label: 'Activity History', description: 'Recent qualifying staff work evidence', requiredCap: 'canViewReports' },
  tickets: { label: 'Ticket Activity', description: 'Ticket queue, workload & response times', requiredCap: 'canViewReports' },
  inactivity: { label: 'Inactivity Reports', description: 'At-risk & confirmed inactivity incidents', requiredCap: 'canViewReports' },
  warnings: { label: 'Warning Management', description: 'Warning records, levels & appeals', requiredCap: 'canApproveWarnings' },
  approvals: { label: 'Warning Approvals', description: 'Pending human review requests', requiredCap: 'canApproveWarnings' },
  leave: { label: 'Leave Management', description: 'Approved leave requests & schedules', requiredCap: 'canManageLeave' },
  analytics: { label: 'Performance Analytics', description: 'Fairness-adjusted performance metrics', requiredCap: 'canViewReports' },
  reports: { label: 'Export Reports', description: 'Generate branded PNG, CSV & PDF reports', requiredCap: 'canViewReports' },
  channels: { label: 'Channel Configuration', description: 'Ticket, alert & fallback channels', requiredCap: 'canConfigureGuild' },
  roles: { label: 'Role Configuration', description: 'Monitored staff roles & custom thresholds', requiredCap: 'canConfigureGuild' },
  features: { label: 'Feature Settings', description: 'Toggle allowed local server features', requiredCap: 'canConfigureGuild' },
  health: { label: 'Monitoring Health', description: 'Coverage verification & manual roster scan', requiredCap: 'canViewReports' },
};

const PAGE_SIZE = 5;

export class ServerManagementDashboard {
  private readonly container: PlatformContainer;

  constructor(container: PlatformContainer) {
    this.container = container;
  }

  public render(
    ctx: ActorGuildContext,
    section: ServerDashboardSection = 'overview',
    page = 0,
  ): DashboardRenderPayload {
    const meta = SERVER_SECTION_META[section];
    const perms = this.container.permissions.assertGuildCapability(
      ctx,
      meta.requiredCap,
      `SERVER_DASHBOARD:${section}`,
    );

    const guildCfg = this.container.guildConfig.getGuildConfigOrThrow(ctx.guildId);
    const safePage = Math.max(0, page);
    const allowAnimated = this.container.features.isEnabled(ctx.guildId, 'animated_assets');
    const files: AttachmentBuilder[] = [];
    const actionButtons: ButtonBuilder[] = [];
    let totalPages = 1;
    let embed: EmbedBuilder;

    const allStaff = this.container.roster.listStaffProfiles(ctx.guildId, { onlyActiveStaff: true });
    const statusMap = {
      ACTIVE: 0,
      AT_RISK: 0,
      INACTIVE: 0,
      ON_LEAVE: 0,
      UNKNOWN: 0,
      NEW_STAFF: 0,
      INSUFFICIENT_WORKLOAD: 0,
      MONITORING_ERROR: 0,
    };
    let totalOpenWorkload = 0;
    for (const s of allStaff) {
      statusMap[s.monitoring_status] = (statusMap[s.monitoring_status] ?? 0) + 1;
      totalOpenWorkload += s.current_workload;
    }

    const ticketSummary = this.container.tickets.getGuildTicketSummary(ctx.guildId);
    const pendingReviews = this.container.reviews.listGuildReviews(ctx.guildId, { pendingOnly: true, limit: 50 });

    switch (section) {
      case 'overview': {
        const recentLogs = this.container.audit.listGuildLogs(ctx.guildId, { limit: 4 });
        const ticketConfigs = this.container.tickets.listTicketChannelConfigs(ctx.guildId);
        const coverage = ticketConfigs.length > 0 ? 'FULL' : 'UNAVAILABLE';

        embed = createBrandEmbed({
          title: `${emojis.get('premium')} Server Management Dashboard — ${guildCfg.guild_name}`,
          tone: 'primary',
          subtitle: `Guild ID: ${guildCfg.guild_id}`,
          description:
            `**Your Access Tier:** ${
              perms.isGlobalOwner
                ? 'Permanent Global Owner'
                : perms.isServerOwner
                  ? 'Discord Server Owner (Full Local Admin)'
                  : perms.isCoOwner
                    ? 'Authorized Co-Owner'
                    : 'Authorized Management Reviewer'
            }\n` +
            `**Active Roster Health:** \`${renderProgressBar(statusMap.ACTIVE, Math.max(1, allStaff.length))}\``,
        }).addFields(
          {
            name: 'Staff Roster Summary',
            value:
              `Total: **${allStaff.length}**\n` +
              `🟢 Active: **${statusMap.ACTIVE}** | 🟡 At-Risk: **${statusMap.AT_RISK}**\n` +
              `🔴 Inactive: **${statusMap.INACTIVE}** | 🔵 On Leave: **${statusMap.ON_LEAVE}**\n` +
              `⚪ Unknown/New: **${statusMap.UNKNOWN + statusMap.NEW_STAFF}**`,
            inline: true,
          },
          {
            name: 'Tickets & Workload',
            value:
              `🎫 Total Tickets: **${ticketSummary.totalTickets}**\n` +
              `📂 Open / Active: **${ticketSummary.openTickets + ticketSummary.inProgressTickets}**\n` +
              `⚡ Assigned Workload: **${totalOpenWorkload}**\n` +
              `🔔 Pending Reviews: **${pendingReviews.length}**`,
            inline: true,
          },
          {
            name: 'Monitoring Coverage',
            value:
              `${COVERAGE_DISPLAY_LABELS[coverage]}\n` +
              `Thresholds: **${guildCfg.at_risk_hours}h / ${guildCfg.inactive_hours}h / ${guildCfg.escalation_hours}h**`,
            inline: true,
          },
          {
            name: 'Recent Management Activity',
            value:
              recentLogs.length === 0
                ? 'No local management actions logged yet.'
                : recentLogs
                    .map((l) => `• \`${l.action_type}\` by <@${l.actor_user_id}> (${l.created_at.slice(11, 19)} UTC)`)
                    .join('\n'),
            inline: false,
          },
        );
        const banner = attachBannerAsset(embed, 'welcome', allowAnimated);
        if (banner) files.push(banner);
        if (perms.canConfigureGuild) {
          actionButtons.push(
            new ButtonBuilder()
              .setCustomId(`tsm:srv:act:${ctx.guildId}:manual_scan`)
              .setLabel('Run Full Roster Scan')
              .setStyle(ButtonStyle.Primary)
              .setEmoji(emojis.forComponent('scanning', { allowAnimated })),
          );
        }
        break;
      }

      case 'roster': {
        totalPages = Math.max(1, Math.ceil(allStaff.length / PAGE_SIZE));
        const slice = allStaff.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('scanning')} Monitored Staff Roster (Page ${safePage + 1}/${totalPages})`,
          tone: 'purple',
          subtitle: guildCfg.guild_name,
          description:
            slice.length === 0
              ? 'No staff members synced yet. Configure staff roles with `/staff roles add` and run `/staff scan`.'
              : slice
                  .map(
                    (s) =>
                      `**${s.display_name}** (@${s.username} | \`${s.user_id}\`)\n` +
                      `└ ${STATUS_DISPLAY_LABELS[s.monitoring_status]} | Tier: *${STAFF_ROLE_CATEGORY_LABELS[s.primary_category]}* | Last Work: ${formatDiscordTimestamp(s.last_qualifying_work_at)}`,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'profiles': {
        totalPages = Math.max(1, Math.ceil(allStaff.length / 3));
        const slice = allStaff.slice(safePage * 3, (safePage + 1) * 3);
        embed = createBrandEmbed({
          title: `${emojis.get('performance')} Individual Staff Profiles (Page ${safePage + 1}/${totalPages})`,
          tone: 'cyan',
          subtitle: guildCfg.guild_name,
          description:
            slice.length === 0
              ? 'No active staff profiles available.'
              : slice
                  .map(
                    (s) =>
                      `### ${s.display_name} (\`${s.user_id}\`)\n` +
                      `• **Status:** ${STATUS_DISPLAY_LABELS[s.monitoring_status]} (Coverage: \`${s.monitoring_coverage}\`)\n` +
                      `• **Tickets:** Assigned **${s.assigned_tickets_count}** | Handled **${s.tickets_handled_count}** | Resolved **${s.tickets_resolved_count}** | Open Workload **${s.current_workload}**\n` +
                      `• **Speed:** 1st Resp **${formatSecondsCompact(s.avg_first_response_sec)}** | Avg Resolve **${formatSecondsCompact(s.avg_resolution_sec)}**\n` +
                      `• **Warnings:** Active **${s.active_warnings_count}/3** (Total: ${s.total_warnings_count})`,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'activity': {
        const events = this.container.db.all<{
          user_id: string;
          event_type: string;
          classification_reason: string;
          occurred_at: string;
        }>(
          `SELECT user_id, event_type, classification_reason, occurred_at
           FROM activity_events
           WHERE guild_id = ? AND is_qualifying = 1
           ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
          [ctx.guildId, PAGE_SIZE, safePage * PAGE_SIZE],
        );
        totalPages = Math.max(1, safePage + (events.length === PAGE_SIZE ? 2 : 1));
        embed = createBrandEmbed({
          title: `${emojis.get('active')} Recent Qualifying Staff Work (Page ${safePage + 1})`,
          tone: 'success',
          subtitle: guildCfg.guild_name,
          description:
            events.length === 0
              ? 'No qualifying work events recorded on this page.'
              : events
                  .map(
                    (e) =>
                      `• <@${e.user_id}> — \`${e.event_type}\` (${formatDiscordTimestamp(e.occurred_at)})\n  *${e.classification_reason}*`,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'tickets': {
        const recentTickets = this.container.tickets.listRecentTickets(ctx.guildId, 6);
        embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Server Ticket Activity & Queue`,
          tone: 'cyan',
          subtitle: guildCfg.guild_name,
          description:
            `**Open:** ${ticketSummary.openTickets} | **In Progress:** ${ticketSummary.inProgressTickets} | **Resolved/Closed:** ${ticketSummary.resolvedTickets + ticketSummary.closedTickets} | **Reopened:** ${ticketSummary.reopenedTickets}\n` +
            `**Avg First Response:** ${formatSecondsCompact(ticketSummary.avgFirstResponseSec)} | **Avg Resolution:** ${formatSecondsCompact(ticketSummary.avgResolutionSec)}\n\n` +
            (recentTickets.length === 0
              ? 'No monitored ticket records yet.'
              : recentTickets
                  .map(
                    (t) =>
                      `• \`${t.ticket_id}\` (#${t.channel_name}) — \`${t.status}\` | Assignee: ${t.assigned_to_user_id ? `<@${t.assigned_to_user_id}>` : 'Unassigned'} | Meaningful Replies: **${t.meaningful_response_count}**`,
                  )
                  .join('\n')),
        });
        const banner = attachBannerAsset(embed, 'ticket-monitoring', allowAnimated);
        if (banner) files.push(banner);
        break;
      }

      case 'inactivity': {
        const incidents = this.container.scanner.listGuildIncidents(ctx.guildId, false, 30);
        totalPages = Math.max(1, Math.ceil(incidents.length / PAGE_SIZE));
        const slice = incidents.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('warning')} Server Inactivity Incident Reports (Page ${safePage + 1}/${totalPages})`,
          tone: 'warning',
          subtitle: guildCfg.guild_name,
          description:
            slice.length === 0
              ? 'No inactivity incidents detected for this server.'
              : slice
                  .map(
                    (i) =>
                      `• \`${i.incident_id}\` — <@${i.staff_user_id}> | \`${i.status}\` (\`${i.severity}\`)\n  Duration: **${i.inactivity_hours.toFixed(1)}h** | Coverage: \`${i.monitoring_coverage}\``,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'warnings': {
        const warns = this.container.warnings.listWarnings(ctx.guildId, { limit: 30 });
        const appeals = this.container.warnings.listAppeals(ctx.guildId, 'PENDING', 5);
        totalPages = Math.max(1, Math.ceil(warns.length / PAGE_SIZE));
        const slice = warns.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('warning')} Warning Management & Appeals (Page ${safePage + 1}/${totalPages})`,
          tone: 'danger',
          subtitle: guildCfg.guild_name,
          description:
            (slice.length === 0
              ? 'No warnings issued in this server.'
              : slice
                  .map(
                    (w) =>
                      `• \`${w.warning_id}\` — <@${w.staff_user_id}> | **Level ${w.warning_level}/3** [\`${w.status}\`]\n` +
                      `  Approved by: ${w.approver_display_name} (\`${w.approver_id}\`) | DM: ${w.dm_delivered ? '✅' : '⚠️ Failed'}\n` +
                      `  Reason: *${w.reason}*`,
                  )
                  .join('\n\n')) +
            (appeals.length > 0
              ? `\n\n**Pending Appeals (${appeals.length}):**\n` +
                appeals.map((a) => `• \`${a.appeal_id}\` (Warning \`${a.warning_id}\`) by <@${a.staff_user_id}>`).join('\n')
              : ''),
        });
        break;
      }

      case 'approvals': {
        totalPages = Math.max(1, Math.ceil(pendingReviews.length / PAGE_SIZE));
        const slice = pendingReviews.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('approval')} Pending Warning Approvals (Page ${safePage + 1}/${totalPages})`,
          tone: 'warning',
          subtitle: guildCfg.guild_name,
          description:
            slice.length === 0
              ? 'Zero pending warning approval requests.'
              : slice
                  .map(
                    (r) =>
                      `• **\`${r.review_id}\`** — Staff <@${r.staff_user_id}> | Status: \`${r.status}\` | Suggested: **Level ${r.suggested_level}/3**\n` +
                      `  Use \`/review approve review_id:${r.review_id}\` or click buttons on the review card.`,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'leave': {
        const leaves = this.container.leave.listGuildLeave(ctx.guildId, { limit: 30 });
        totalPages = Math.max(1, Math.ceil(leaves.length / PAGE_SIZE));
        const slice = leaves.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('active')} Approved Leave Management (Page ${safePage + 1}/${totalPages})`,
          tone: 'cyan',
          subtitle: guildCfg.guild_name,
          description:
            (slice.length === 0
              ? 'No leave records registered yet.'
              : slice
                  .map(
                    (l) =>
                      `• \`${l.leave_id}\` — <@${l.staff_user_id}> [\`${l.status}\`]\n` +
                      `  Window: ${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)} | Reason: *${l.reason}*`,
                  )
                  .join('\n\n')),
        });
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId(`tsm:srv:act:${ctx.guildId}:open_leave_modal`)
            .setLabel('Record / Approve Staff Leave')
            .setStyle(ButtonStyle.Success),
        );
        break;
      }

      case 'analytics': {
        const report = this.container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: 'WEEKLY' });
        embed = createBrandEmbed({
          title: `${emojis.get('analytics')} Fairness-Adjusted Server Analytics (7-Day)`,
          tone: 'purple',
          subtitle: guildCfg.guild_name,
          description:
            `Staff are evaluated using workload availability, consistency, and verified monitoring coverage — never raw ticket count alone.`,
        }).addFields(
          {
            name: 'Ticket Flow (7d)',
            value: `Opened: **${report.ticketMetrics.openedInPeriod}** | Handled: **${report.ticketMetrics.handledInPeriod}** | Resolved: **${report.ticketMetrics.resolvedInPeriod}**`,
            inline: false,
          },
          {
            name: 'Top Fairness-Evaluated Staff',
            value:
              report.staffRows.length === 0
                ? 'No staff data yet.'
                : report.staffRows
                    .slice(0, 5)
                    .map(
                      (r) =>
                        `• **${r.username}** — Consistency: **${r.workConsistencyPct}%** | Handled: **${r.ticketsHandled}** | *${r.fairnessNote}*`,
                    )
                    .join('\n'),
            inline: false,
          },
        );
        break;
      }

      case 'reports': {
        embed = createBrandEmbed({
          title: `${emojis.get('analytics')} Branded Server Reports (PNG / CSV / PDF)`,
          tone: 'purple',
          subtitle: guildCfg.guild_name,
          description:
            'Export live database analytics for this server in high-DPI PNG, spreadsheet CSV, or multi-section PDF format.',
        });
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId(`tsm:srv:act:${ctx.guildId}:export_png`)
            .setLabel('Export PNG Report')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(emojis.forComponent('analytics', { allowAnimated })),
          new ButtonBuilder()
            .setCustomId(`tsm:srv:act:${ctx.guildId}:export_csv`)
            .setLabel('Export CSV Report')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(emojis.forComponent('database', { allowAnimated })),
          new ButtonBuilder()
            .setCustomId(`tsm:srv:act:${ctx.guildId}:export_pdf`)
            .setLabel('Export PDF Report')
            .setStyle(ButtonStyle.Success)
            .setEmoji(emojis.forComponent('premium', { allowAnimated })),
        );
        break;
      }

      case 'channels': {
        const tChans = this.container.tickets.listTicketChannelConfigs(ctx.guildId);
        embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Channel & Alert Routing Configuration`,
          tone: 'primary',
          subtitle: guildCfg.guild_name,
          description:
            `**Alert Channel:** ${guildCfg.alert_channel_id ? `<#${guildCfg.alert_channel_id}>` : 'Not Set'}\n` +
            `**Audit Log Channel:** ${guildCfg.log_channel_id ? `<#${guildCfg.log_channel_id}>` : 'Not Set'}\n` +
            `**Fallback Review Channel:** ${guildCfg.fallback_review_channel_id ? `<#${guildCfg.fallback_review_channel_id}>` : 'Not Set'}\n\n` +
            `**Configured Ticket Channels/Categories (${tChans.length}):**\n` +
            (tChans.length === 0
              ? 'None configured yet. Use `/ticket setup`, `/ticket channels`, or `/ticket categories`.'
              : tChans
                  .map((c) => `• \`${c.target_type}\` **${c.channel_name}** (\`${c.channel_id}\`) — Adapter: \`${c.adapter_type}\``)
                  .join('\n')),
        });
        break;
      }

      case 'roles': {
        const roles = this.container.roster.listStaffRoles(ctx.guildId);
        embed = createBrandEmbed({
          title: `${emojis.get('security')} Configured Staff Roles (${roles.length})`,
          tone: 'purple',
          subtitle: guildCfg.guild_name,
          description:
            roles.length === 0
              ? 'No staff roles configured yet. Use `/staff roles add` to add staff tiers.'
              : roles
                  .map(
                    (r) =>
                      `• <@&${r.role_id}> (**${r.role_name}**) — *${STAFF_ROLE_CATEGORY_LABELS[r.category]}*` +
                      (r.custom_inactive_hours ? ` [Custom Inactive: ${r.custom_inactive_hours}h]` : ''),
                  )
                  .join('\n'),
        });
        break;
      }

      case 'features': {
        const feats = this.container.features.listGuildFeatures(ctx.guildId);
        totalPages = Math.max(1, Math.ceil(feats.length / 9));
        const slice = feats.slice(safePage * 9, (safePage + 1) * 9);
        embed = createBrandEmbed({
          title: `${emojis.get('premium')} Local Feature Switches (Page ${safePage + 1}/${totalPages})`,
          tone: 'purple',
          subtitle: guildCfg.guild_name,
          description: slice
            .map((f) => {
              const badge = f.globallyDisabled
                ? '🔒 Global Lock'
                : f.effectiveEnabled
                  ? '🟢 Enabled'
                  : '⚪ Disabled';
              return `${badge} — \`${f.key}\` (${f.label})`;
            })
            .join('\n'),
        });
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId(`tsm:srv:act:${ctx.guildId}:open_feature_modal`)
            .setLabel('Toggle Server Feature')
            .setStyle(ButtonStyle.Primary),
        );
        break;
      }

      case 'health': {
        const diag = this.container.tickets.runDiagnostics(ctx.guildId);
        embed = createBrandEmbed({
          title: `${emojis.get('performance')} Server Monitoring Health & Diagnostics`,
          tone: diag.coverageLevel === 'FULL' ? 'success' : 'warning',
          subtitle: guildCfg.guild_name,
          description:
            `**Monitoring Coverage:** ${COVERAGE_DISPLAY_LABELS[diag.coverageLevel]}\n` +
            `**Accessible Ticket Targets:** ${diag.accessibleCount} | **Inaccessible:** ${diag.inaccessibleCount}\n\n` +
            diag.adapterReports
              .map(
                (ar) =>
                  `**${ar.adapterName}** (\`${ar.adapterId}\`) — ${ar.healthy ? '🟢 Healthy' : '🟡 Attention Needed'}\n` +
                  (ar.missingPermissions.length > 0 ? `Missing: ${ar.missingPermissions.join('; ')}\n` : ''),
              )
              .join('\n'),
        });
        const banner = attachBannerAsset(embed, 'system-health', allowAnimated);
        if (banner) files.push(banner);
        if (perms.canConfigureGuild) {
          actionButtons.push(
            new ButtonBuilder()
              .setCustomId(`tsm:srv:act:${ctx.guildId}:manual_scan`)
              .setLabel('Trigger Manual Roster Scan')
              .setStyle(ButtonStyle.Primary)
              .setEmoji(emojis.forComponent('scanning', { allowAnimated })),
          );
        }
        break;
      }
    }

    // Filter visible dropdown sections to only those permitted for this actor!
    const allowedSections = SERVER_DASHBOARD_SECTIONS.filter(
      (key) => perms[SERVER_SECTION_META[key].requiredCap],
    );

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId(`tsm:srv:nav:${ctx.guildId}`)
      .setPlaceholder('Select Server Dashboard Section...')
      .addOptions(
        allowedSections.map((key) => ({
          label: SERVER_SECTION_META[key].label,
          description: SERVER_SECTION_META[key].description,
          value: key,
          default: key === section,
        })),
      );

    const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`tsm:srv:page:${ctx.guildId}:${section}:${Math.max(0, safePage - 1)}`)
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage <= 0),
        new ButtonBuilder()
          .setCustomId(`tsm:srv:page:${ctx.guildId}:${section}:${safePage}`)
          .setLabel('Refresh')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`tsm:srv:page:${ctx.guildId}:${section}:${safePage + 1}`)
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(safePage + 1 >= totalPages),
      ),
    ];

    if (actionButtons.length > 0) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons));
    }

    return {
      embeds: [embed],
      components,
      files,
    };
  }

  public buildQuickLeaveModal(guildId: string): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`tsm:srv:modal:${guildId}:create_leave`)
      .setTitle('Approve Staff Leave Period')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('staff_user_id')
            .setLabel('Staff Discord Numeric User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('start_date')
            .setLabel('Start Date ISO (YYYY-MM-DD)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('2026-11-11')
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('end_date')
            .setLabel('End Date ISO (YYYY-MM-DD)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('2026-11-18')
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason for Leave')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );
  }

  public buildToggleServerFeatureModal(guildId: string): ModalBuilder {
    return new ModalBuilder()
      .setCustomId(`tsm:srv:modal:${guildId}:toggle_feature`)
      .setTitle('Toggle Server Feature Switch')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('feature_key')
            .setLabel('Feature Key (e.g. animated_assets)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
  }
}
