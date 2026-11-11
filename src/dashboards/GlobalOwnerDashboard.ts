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
import { BRANDING, GLOBAL_OWNER_ID } from '../config/branding';
import { emojis } from '../config/emojis';
import { renderProgressBar } from '../config/theme';
import { ALL_FEATURE_KEYS, APPROVAL_POLICY_LABELS, ApprovalPolicy, FEATURE_LABELS, FeatureKey } from '../types/domain';
import { attachBannerAsset, createBrandEmbed } from '../utils/embeds';

export const GLOBAL_DASHBOARD_SECTIONS = [
  'overview',
  'servers',
  'admins',
  'staff',
  'inactivity',
  'reviews',
  'tickets',
  'reports',
  'features',
  'security',
  'audit',
  'health',
] as const;

export type GlobalDashboardSection = (typeof GLOBAL_DASHBOARD_SECTIONS)[number];

const SECTION_META: Readonly<Record<GlobalDashboardSection, { label: string; description: string }>> = {
  overview: { label: '1. Overview', description: 'Global KPIs, identity & cross-server telemetry' },
  servers: { label: '2. Server Management', description: 'Inspect all registered Discord servers' },
  admins: { label: '3. Bot Administrators', description: 'Appoint or revoke Global Owner bot admins' },
  staff: { label: '4. Staff Monitoring', description: 'Global staff roster status breakdown' },
  inactivity: { label: '5. Inactivity Cases', description: 'All active & escalated inactivity incidents' },
  reviews: { label: '6. Warning Reviews & Inbox', description: 'Pending approvals & Global Owner Inbox' },
  tickets: { label: '7. Ticket Analytics', description: 'Global ticket volume & handling metrics' },
  reports: { label: '8. Global Reports', description: 'Export PNG, CSV & PDF executive reports' },
  features: { label: '9. Feature Management', description: 'Control global feature restrictions' },
  security: { label: '10. Security Policies', description: 'Approval policies & threshold bounds' },
  audit: { label: '11. Audit Logs', description: 'Paginated global security & management logs' },
  health: { label: '12. System Health', description: 'Database integrity, backups & scheduler state' },
};

export interface DashboardRenderPayload {
  embeds: EmbedBuilder[];
  components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>>;
  files: AttachmentBuilder[];
}

const PAGE_SIZE = 5;

export class GlobalOwnerDashboard {
  private readonly container: PlatformContainer;

  constructor(container: PlatformContainer) {
    this.container = container;
  }

  public render(actorUserId: string, section: GlobalDashboardSection = 'overview', page = 0): DashboardRenderPayload {
    this.container.permissions.assertGlobalOwner(actorUserId, `VIEW_GLOBAL_DASHBOARD:${section}`);

    const safePage = Math.max(0, page);
    const stats = this.container.analytics.buildGlobalAnalytics(actorUserId);
    const files: AttachmentBuilder[] = [];

    let embed: EmbedBuilder;
    let totalPages = 1;
    const actionButtons: ButtonBuilder[] = [];

    switch (section) {
      case 'overview': {
        const integrity = this.container.db.integrityCheck();
        const recentAudit = this.container.audit.listGlobalLogs(actorUserId, true, { limit: 4 });
        embed = createBrandEmbed({
          title: `${emojis.get('owner')} Global Owner Command Center — Overview`,
          tone: 'primary',
          subtitle: `Authorized Global Owner: ${GLOBAL_OWNER_ID}`,
          description:
            `**Platform:** ${BRANDING.projectName} (${BRANDING.creatorIdentity})\n` +
            `**System Health:** ${integrity.ok ? '🟢 HEALTHY (SQLite WAL Verified)' : '🔴 DATABASE ALERT'}`,
        }).addFields(
          { name: 'Registered Servers', value: `**${stats.totalGuilds}**`, inline: true },
          { name: 'Configured Staff', value: `**${stats.totalStaff}**`, inline: true },
          { name: 'Pending Reviews', value: `**${stats.pendingReviews}**`, inline: true },
          {
            name: 'Global Staff Status',
            value:
              `🟢 Active: **${stats.statusBreakdown.ACTIVE}**\n` +
              `🟡 At-Risk: **${stats.statusBreakdown.AT_RISK}**\n` +
              `🔴 Inactive: **${stats.statusBreakdown.INACTIVE}**\n` +
              `⚪ Unknown/New: **${stats.statusBreakdown.UNKNOWN + stats.statusBreakdown.NEW_STAFF}**`,
            inline: true,
          },
          {
            name: 'Tickets & Warnings',
            value:
              `🎫 Monitored: **${stats.totalTicketsMonitored}**\n` +
              `✅ Handled: **${stats.totalTicketsHandled}**\n` +
              `⚠️ Total Warnings: **${stats.totalWarnings}**\n` +
              `🚨 Monitoring Errors: **${stats.monitoringErrors}**`,
            inline: true,
          },
          {
            name: 'Recent Global Activity',
            value:
              recentAudit.length === 0
                ? 'No audit events recorded yet.'
                : recentAudit
                    .map((a) => `• \`${a.action_type}\` by \`${a.actor_user_id}\` (${a.created_at.slice(11, 19)} UTC)`)
                    .join('\n'),
            inline: false,
          },
        );
        const banner = attachBannerAsset(embed, 'owner-dashboard', true);
        if (banner) files.push(banner);
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId('tsm:god:act:run_due_scans')
            .setLabel('Run Due Scheduled Scans')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(emojis.forComponent('scanning')),
        );
        break;
      }

      case 'servers': {
        const allServers = stats.guildSummaries;
        totalPages = Math.max(1, Math.ceil(allServers.length / PAGE_SIZE));
        const slice = allServers.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('owner')} Global Server Management (Page ${safePage + 1}/${totalPages})`,
          tone: 'purple',
          description:
            slice.length === 0
              ? 'No Discord servers registered yet.'
              : slice
                  .map(
                    (g) =>
                      `**${g.guildName}** (\`${g.guildId}\`)\n` +
                      `└ Staff: **${g.staffCount}** (🟢 ${g.activeCount} / 🔴 ${g.inactiveCount}) | Tickets: **${g.ticketsTotal}** | Pending Reviews: **${g.pendingReviews}** | Active Warnings: **${g.warningsActive}**`,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'admins': {
        const admins = this.container.permissions.listBotAdmins();
        totalPages = Math.max(1, Math.ceil(admins.length / PAGE_SIZE));
        const slice = admins.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('security')} Authorized Bot Administrators (Page ${safePage + 1}/${totalPages})`,
          tone: 'cyan',
          description:
            `Only Permanent Global Owner (\`${GLOBAL_OWNER_ID}\`) can appoint or revoke bot administrators.\n\n` +
            (slice.length === 0
              ? 'No subordinate bot administrators appointed.'
              : slice
                  .map(
                    (a) =>
                      `• **${a.username}** (\`${a.user_id}\`)\n  Scopes: ${a.scopes.map((s) => `\`${s}\``).join(', ') || 'None'}`,
                  )
                  .join('\n\n')),
        });
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId('tsm:god:act:open_add_admin_modal')
            .setLabel('Add Bot Admin')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('tsm:god:act:open_remove_admin_modal')
            .setLabel('Remove Bot Admin')
            .setStyle(ButtonStyle.Danger),
        );
        break;
      }

      case 'staff': {
        const activeRatio = renderProgressBar(stats.statusBreakdown.ACTIVE, Math.max(1, stats.totalStaff));
        embed = createBrandEmbed({
          title: `${emojis.get('scanning')} Global Staff Monitoring Telemetry`,
          tone: 'primary',
          description: `**Global Active Ratio:** \`${activeRatio}\``,
        }).addFields(
          { name: '🟢 ACTIVE', value: `${stats.statusBreakdown.ACTIVE}`, inline: true },
          { name: '🟡 AT RISK', value: `${stats.statusBreakdown.AT_RISK}`, inline: true },
          { name: '🔴 INACTIVE', value: `${stats.statusBreakdown.INACTIVE}`, inline: true },
          { name: '🔵 ON LEAVE', value: `${stats.statusBreakdown.ON_LEAVE}`, inline: true },
          { name: '🟠 INSUFFICIENT WORKLOAD', value: `${stats.statusBreakdown.INSUFFICIENT_WORKLOAD}`, inline: true },
          { name: '🆕 NEW STAFF / ⚪ UNKNOWN', value: `${stats.statusBreakdown.NEW_STAFF} / ${stats.statusBreakdown.UNKNOWN}`, inline: true },
          { name: '🚨 MONITORING ERROR', value: `${stats.statusBreakdown.MONITORING_ERROR}`, inline: true },
        );
        break;
      }

      case 'inactivity': {
        const incidents = this.container.scanner.listGlobalIncidents(true, 50);
        totalPages = Math.max(1, Math.ceil(incidents.length / PAGE_SIZE));
        const slice = incidents.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('warning')} Global Open Inactivity Cases (Page ${safePage + 1}/${totalPages})`,
          tone: 'warning',
          description:
            slice.length === 0
              ? 'No open inactivity cases across any server.'
              : slice
                  .map(
                    (inc) =>
                      `• \`${inc.incident_id}\` — Staff \`${inc.staff_user_id}\` in Server \`${inc.guild_id}\`\n` +
                      `  Severity: \`${inc.severity}\` | Inactive: **${inc.inactivity_hours.toFixed(1)}h** | Coverage: \`${inc.monitoring_coverage}\``,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'reviews': {
        const reviews = this.container.reviews.listGlobalReviews(actorUserId, true, 50);
        const inbox = this.container.notifications.listGlobalOwnerInbox(actorUserId, false, 5);
        totalPages = Math.max(1, Math.ceil(reviews.length / PAGE_SIZE));
        const slice = reviews.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
        embed = createBrandEmbed({
          title: `${emojis.get('notifications')} Global Warning Reviews & Persistent Inbox (Page ${safePage + 1}/${totalPages})`,
          tone: 'warning',
          description:
            (slice.length === 0
              ? 'Zero pending warning approval requests.'
              : slice
                  .map(
                    (r) =>
                      `• **\`${r.review_id}\`** — Staff \`${r.staff_user_id}\` (Server \`${r.guild_id}\`)\n` +
                      `  Status: \`${r.status}\` | Policy: \`${r.required_policy}\` | Suggested Level: **${r.suggested_level}/3**`,
                  )
                  .join('\n\n')) +
            `\n\n**Global Owner Inbox (Retained Fallback Feed):**\n` +
            (inbox.length === 0
              ? '• Inbox is empty.'
              : inbox
                  .map(
                    (n) =>
                      `• \`${n.notification_type}\`: ${n.summary} [${n.delivery_channel}]`,
                  )
                  .join('\n')),
        });
        break;
      }

      case 'tickets': {
        embed = createBrandEmbed({
          title: `${emojis.get('tickets')} Global Ticket Monitoring Analytics`,
          tone: 'cyan',
          description: 'Aggregated real-time ticket lifecycle performance across all registered guilds.',
        }).addFields(
          { name: 'Total Monitored', value: `${stats.totalTicketsMonitored}`, inline: true },
          { name: 'Meaningfully Handled', value: `${stats.totalTicketsHandled}`, inline: true },
          { name: 'Resolved', value: `${stats.totalTicketsResolved}`, inline: true },
        );
        break;
      }

      case 'reports': {
        embed = createBrandEmbed({
          title: `${emojis.get('analytics')} Global Executive Reports & Exports`,
          tone: 'purple',
          description:
            'Generate real-time cross-server executive reports directly from SQLite records.\n' +
            'All exports embed permanent Tanveer identity and footer branding.',
        });
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId('tsm:god:act:export_png')
            .setLabel('Export Global PNG')
            .setStyle(ButtonStyle.Primary)
            .setEmoji(emojis.forComponent('analytics')),
          new ButtonBuilder()
            .setCustomId('tsm:god:act:export_csv')
            .setLabel('Export Global CSV')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(emojis.forComponent('database')),
          new ButtonBuilder()
            .setCustomId('tsm:god:act:export_pdf')
            .setLabel('Export Global PDF')
            .setStyle(ButtonStyle.Success)
            .setEmoji(emojis.forComponent('premium')),
        );
        break;
      }

      case 'features': {
        const disabledSet = this.container.features.getGloballyDisabledFeatures();
        totalPages = Math.max(1, Math.ceil(ALL_FEATURE_KEYS.length / 9));
        const slice = ALL_FEATURE_KEYS.slice(safePage * 9, (safePage + 1) * 9);
        embed = createBrandEmbed({
          title: `${emojis.get('premium')} Global Feature Restrictions (Page ${safePage + 1}/${totalPages})`,
          tone: 'purple',
          description:
            `Global Owner locks override local server settings without erasing historical data.\n\n` +
            slice
              .map(
                (k) =>
                  `${disabledSet.has(k) ? '🔒 **GLOBALLY RESTRICTED**' : '🟢 **ALLOWED**'} — \`${k}\` (${FEATURE_LABELS[k]})`,
              )
              .join('\n'),
        });
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId('tsm:god:act:open_feature_modal')
            .setLabel('Toggle Global Feature Lock')
            .setStyle(ButtonStyle.Primary),
        );
        break;
      }

      case 'security': {
        const globalCfg = this.container.guildConfig.getGlobalConfig();
        embed = createBrandEmbed({
          title: `${emojis.get('security')} Global Security & Approval Policies`,
          tone: 'primary',
          description: `Immutable Global Owner ID: \`${GLOBAL_OWNER_ID}\``,
        }).addFields(
          {
            name: 'Global Approval Policy',
            value: `${APPROVAL_POLICY_LABELS[globalCfg.global_approval_policy]} (\`${globalCfg.global_approval_policy}\`)`,
            inline: false,
          },
          {
            name: 'Allow Guild Policy Override',
            value: globalCfg.allow_guild_policy_override ? 'Enabled' : 'Locked Globally',
            inline: true,
          },
          {
            name: 'At-Risk Bounds',
            value: `${globalCfg.min_at_risk_hours}h – ${globalCfg.max_at_risk_hours}h`,
            inline: true,
          },
          {
            name: 'Inactive Bounds',
            value: `${globalCfg.min_inactive_hours}h – ${globalCfg.max_inactive_hours}h`,
            inline: true,
          },
          {
            name: 'Escalation Bounds',
            value: `${globalCfg.min_escalation_hours}h – ${globalCfg.max_escalation_hours}h`,
            inline: true,
          },
          {
            name: 'Rate Limit',
            value: `${globalCfg.rate_limit_actions_per_minute} actions/min`,
            inline: true,
          },
        );
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId('tsm:god:act:cycle_policy')
            .setLabel('Cycle Global Approval Policy')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('tsm:god:act:toggle_override_lock')
            .setLabel(globalCfg.allow_guild_policy_override ? 'Lock Guild Overrides' : 'Unlock Guild Overrides')
            .setStyle(ButtonStyle.Secondary),
        );
        break;
      }

      case 'audit': {
        const logs = this.container.audit.listGlobalLogs(actorUserId, true, {
          limit: PAGE_SIZE,
          offset: safePage * PAGE_SIZE,
        });
        totalPages = Math.max(1, safePage + (logs.length === PAGE_SIZE ? 2 : 1));
        embed = createBrandEmbed({
          title: `${emojis.get('database')} Global Security & Management Audit Logs (Page ${safePage + 1})`,
          tone: 'midnight',
          description:
            logs.length === 0
              ? 'No audit records on this page.'
              : logs
                  .map(
                    (l) =>
                      `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}**\n` +
                      `  Actor: \`${l.actor_user_id}\` | Guild: \`${l.guild_id ?? 'GLOBAL'}\` | ${l.created_at}`,
                  )
                  .join('\n\n'),
        });
        break;
      }

      case 'health': {
        const integrity = this.container.db.integrityCheck();
        const schedules = this.container.scheduler.getSchedulerStatus();
        const backups = this.container.backups.listBackups();
        embed = createBrandEmbed({
          title: `${emojis.get('performance')} Platform System Health & Recovery`,
          tone: integrity.ok ? 'success' : 'danger',
          description:
            `**Database Driver:** SQLite WAL (\`${this.container.db.dbPath}\`)\n` +
            `**Integrity Check:** ${integrity.ok ? '🟢 OK' : `🔴 ${integrity.details.join(', ')}`}\n` +
            `**Available Verified Backups:** ${backups.length}`,
        }).addFields({
          name: 'Persistent Scheduler Locks',
          value:
            schedules.length === 0
              ? 'No active guild scan schedules yet.'
              : schedules
                  .slice(0, 6)
                  .map(
                    (s) =>
                      `• \`${s.lock_name}\` — Runs: ${s.run_count} | Status: ${s.last_status ?? 'IDLE'} | Next: ${s.next_run_at ?? 'Pending'}`,
                  )
                  .join('\n'),
        });
        const banner = attachBannerAsset(embed, 'system-health', true);
        if (banner) files.push(banner);
        actionButtons.push(
          new ButtonBuilder()
            .setCustomId('tsm:god:act:create_backup')
            .setLabel('Create Atomic DB Backup')
            .setStyle(ButtonStyle.Success)
            .setEmoji(emojis.forComponent('database')),
        );
        break;
      }
    }

    const navMenu = new StringSelectMenuBuilder()
      .setCustomId('tsm:god:nav')
      .setPlaceholder('Navigate Global Owner Command Center...')
      .addOptions(
        GLOBAL_DASHBOARD_SECTIONS.map((key) => ({
          label: SECTION_META[key].label,
          description: SECTION_META[key].description,
          value: key,
          default: key === section,
        })),
      );

    const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(navMenu),
    ];

    const navButtons: ButtonBuilder[] = [
      new ButtonBuilder()
        .setCustomId(`tsm:god:page:${section}:${Math.max(0, safePage - 1)}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`tsm:god:page:${section}:${safePage}`)
        .setLabel('Refresh')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`tsm:god:page:${section}:${safePage + 1}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage + 1 >= totalPages),
    ];

    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...navButtons));

    if (actionButtons.length > 0) {
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons));
    }

    return {
      embeds: [embed],
      components,
      files,
    };
  }

  public cycleApprovalPolicy(actorUserId: string): ApprovalPolicy {
    this.container.permissions.assertGlobalOwner(actorUserId, 'CYCLE_GLOBAL_APPROVAL_POLICY');
    const order: ApprovalPolicy[] = [
      'ANY_AUTHORIZED_REVIEWER',
      'GLOBAL_OWNER_REQUIRED',
      'TWO_PERSON_APPROVAL',
      'GLOBAL_AND_SERVER_OWNER',
    ];
    const current = this.container.guildConfig.getGlobalConfig().global_approval_policy;
    const next = order[(order.indexOf(current) + 1) % order.length];
    this.container.guildConfig.updateGlobalSecurityConfig(actorUserId, { globalApprovalPolicy: next });
    return next;
  }

  public toggleGuildOverrideLock(actorUserId: string): boolean {
    this.container.permissions.assertGlobalOwner(actorUserId, 'TOGGLE_GUILD_OVERRIDE_LOCK');
    const current = this.container.guildConfig.getGlobalConfig().allow_guild_policy_override === 1;
    const updated = this.container.guildConfig.updateGlobalSecurityConfig(actorUserId, {
      allowGuildPolicyOverride: !current,
    });
    return updated.allow_guild_policy_override === 1;
  }

  public toggleGlobalFeatureByKey(actorUserId: string, rawKey: string): { key: FeatureKey; allowed: boolean } {
    this.container.permissions.assertGlobalOwner(actorUserId, 'TOGGLE_GLOBAL_FEATURE');
    const key = rawKey.trim() as FeatureKey;
    if (!ALL_FEATURE_KEYS.includes(key)) {
      throw new Error(`Unknown feature key "${rawKey}". Valid keys: ${ALL_FEATURE_KEYS.join(', ')}`);
    }
    const disabledSet = this.container.features.getGloballyDisabledFeatures();
    const nextAllowed = disabledSet.has(key);
    this.container.features.setGlobalFeatureRestriction(actorUserId, key, nextAllowed);
    return { key, allowed: nextAllowed };
  }

  public buildAddAdminModal(): ModalBuilder {
    return new ModalBuilder()
      .setCustomId('tsm:god:modal:add_admin')
      .setTitle('Appoint Bot Administrator')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('user_id')
            .setLabel('Discord Numeric User ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('username')
            .setLabel('Discord Username / Label')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
  }

  public buildRemoveAdminModal(): ModalBuilder {
    return new ModalBuilder()
      .setCustomId('tsm:god:modal:remove_admin')
      .setTitle('Remove Bot Administrator')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('user_id')
            .setLabel('Discord Numeric User ID to Revoke')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
  }

  public buildToggleGlobalFeatureModal(): ModalBuilder {
    return new ModalBuilder()
      .setCustomId('tsm:god:modal:toggle_feature')
      .setTitle('Toggle Global Feature Restriction')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('feature_key')
            .setLabel('Feature Key (e.g. ticket_monitoring)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true),
        ),
      );
  }
}
