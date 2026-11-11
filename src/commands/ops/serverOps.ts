import { ALL_FEATURE_KEYS, FEATURE_LABELS, FeatureKey } from '../../types/domain';
import { assertLocal, brand, reply, requireGuild, resolveAccess } from './shared';
import { CommandOperation } from './types';

export const SERVER_OPERATIONS: CommandOperation[] = [
  {
    root: 'server',
    sub: 'setup',
    description: 'Configure alert, log and fallback channels for this server',
    options: [
      { kind: 'channel', name: 'alert_channel', description: 'Channel for staff alerts' },
      { kind: 'channel', name: 'log_channel', description: 'Channel for audit / log notifications' },
      { kind: 'channel', name: 'fallback_channel', description: 'Fallback channel when DMs fail' },
      { kind: 'string', name: 'support_channels', description: 'Comma-separated support work channel IDs' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await resolveAccess(interaction, container);
      if (!access.isGlobalOwner && !access.isServerOwner) {
        container.authz.assertLocalScope(access, 'SERVER_MANAGE_SETTINGS', 'SERVER_SETUP');
      }
      const alert = interaction.options.getChannel('alert_channel', false);
      const log = interaction.options.getChannel('log_channel', false);
      const fallback = interaction.options.getChannel('fallback_channel', false);
      const support = interaction.options.getString('support_channels', false);
      if (!alert && !log && !fallback && !support) {
        const cfg = container.guildConfig.getGuildConfigOrThrow(access.guildId);
        await reply(
          interaction,
          brand(
            '⚙️ Server Setup',
            [
              `**Alert channel:** ${cfg.alert_channel_id ? `<#${cfg.alert_channel_id}>` : 'not configured'}`,
              `**Log channel:** ${cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : 'not configured'}`,
              `**Fallback channel:** ${cfg.fallback_review_channel_id ? `<#${cfg.fallback_review_channel_id}>` : 'not configured'}`,
              `**Support channels:** ${cfg.support_work_channel_ids_json}`,
              '',
              'Pass any channel option to update configuration.',
            ].join('\n'),
            'cyan',
          ),
        );
        return;
      }
      const updated = container.guildConfig.updateGuildChannels(access.guildId, access.userId, {
        ...(alert ? { alertChannelId: alert.id } : {}),
        ...(log ? { logChannelId: log.id } : {}),
        ...(fallback ? { fallbackReviewChannelId: fallback.id } : {}),
        ...(support
          ? {
              supportWorkChannelIds: support
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            }
          : {}),
      });
      await reply(
        interaction,
        brand(
          '✅ Server Setup Updated',
          [
            `**Alert channel:** ${updated.alert_channel_id ? `<#${updated.alert_channel_id}>` : '—'}`,
            `**Log channel:** ${updated.log_channel_id ? `<#${updated.log_channel_id}>` : '—'}`,
            `**Fallback channel:** ${updated.fallback_review_channel_id ? `<#${updated.fallback_review_channel_id}>` : '—'}`,
          ].join('\n'),
          'success',
        ),
      );
    },
  },
  {
    root: 'server',
    sub: 'info',
    description: 'Show server configuration and ownership information',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'SERVER_INFO');
      const cfg = container.guildConfig.getGuildConfigOrThrow(access.guildId);
      const roles = container.roster.listStaffRoles(access.guildId, true);
      const staff = container.roster.listStaffProfiles(access.guildId, { onlyActiveStaff: true });
      const ticketConfigs = container.tickets.listTicketChannelConfigs(access.guildId);
      await reply(
        interaction,
        brand(
          `⚙️ ${cfg.guild_name} — Server Information`,
          [
            `**Guild ID:** \`${cfg.guild_id}\``,
            `**Verified owner:** \`${cfg.owner_id}\` ${access.ownershipVerified ? '(live Discord verification)' : '(stored — Discord owner lookup unavailable)'}`,
            `**Installed:** ${cfg.installed_at}`,
            `**Staff roles:** ${roles.length} · **Active staff:** ${staff.length}`,
            `**Ticket channels:** ${ticketConfigs.length}`,
            `**Thresholds:** at-risk ${cfg.at_risk_hours}h · inactive ${cfg.inactive_hours}h · escalation ${cfg.escalation_hours}h`,
            `**Scan interval:** ${cfg.scan_interval_minutes} minutes`,
            `**Your role:** ${access.actorKind}`,
          ].join('\n'),
          'primary',
        ),
      );
    },
  },
  {
    root: 'server',
    sub: 'status',
    description: 'Show live monitoring, ticket and scheduler status',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'SERVER_STATUS');
      const staff = container.roster.listStaffProfiles(access.guildId, { onlyActiveStaff: true });
      const tickets = container.tickets.getGuildTicketSummary(access.guildId);
      const pendingReviews = container.reviews.listGuildReviews(access.guildId, { pendingOnly: true });
      const scheduler = container.scheduler.getSchedulerStatus().find((s) => s.lock_name.includes(access.guildId));
      const scans = container.staffDiscovery.listScanHistory(access.guildId, 1);
      const statusCount = staff.reduce<Record<string, number>>((acc, s) => {
        acc[s.monitoring_status] = (acc[s.monitoring_status] ?? 0) + 1;
        return acc;
      }, {});
      await reply(
        interaction,
        brand(
          `📡 Monitoring Status — ${access.guildName}`,
          [
            `**Staff:** ${staff.length} (${Object.entries(statusCount).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none'})`,
            `**Tickets:** ${tickets.totalTickets} total · ${tickets.openTickets} open · ${tickets.inProgressTickets} active · ${tickets.resolvedTickets} resolved`,
            `**Pending reviews:** ${pendingReviews.length}`,
            `**Scheduler:** ${scheduler ? `${scheduler.last_status ?? 'idle'} · next ${scheduler.next_run_at ?? '—'}` : 'not scheduled'}`,
            `**Last scan:** ${scans[0] ? `${scans[0].completed_at} (${scans[0].scan_type})` : 'never'}`,
            `**Auto-claim delay:** ${container.settings.getNumber('ticket_auto_claim_minutes')} minutes`,
          ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'server',
    sub: 'features',
    description: 'List or toggle server feature switches',
    options: [
      {
        kind: 'string',
        name: 'feature',
        description: 'Optional feature to toggle',
        choices: ALL_FEATURE_KEYS.map((k) => ({ name: FEATURE_LABELS[k], value: k })),
      },
      { kind: 'boolean', name: 'enabled', description: 'Enable or disable the selected feature' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'SERVER_FEATURES');
      const feature = interaction.options.getString('feature', false) as FeatureKey | null;
      const enabled = interaction.options.getBoolean('enabled', false);
      if (feature && enabled !== null) {
        container.features.setGuildFeature(access.guildId, access.userId, feature, enabled);
      }
      const features = container.features.listGuildFeatures(access.guildId);
      await reply(
        interaction,
        brand(
          '💎 Server Feature Switches',
          features
            .map((f) => `${f.effectiveEnabled ? '🟢' : '🔴'} **${FEATURE_LABELS[f.key]}** \`${f.key}\`${f.globallyDisabled ? ' *(globally locked)*' : ''}`)
            .join('\n'),
          'purple',
        ),
      );
    },
  },
  {
    root: 'server',
    sub: 'diagnostics',
    description: 'Run ticket permissions, intent and database diagnostics',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'SERVER_DIAGNOSTICS');
      const guild = requireGuild(interaction);
      const diag = container.tickets.runDiagnostics(access.guildId, undefined, container.config.enableMessageContentIntent);
      const integrity = container.db.integrityCheck();
      const backups = container.backups.listBackups();
      await reply(
        interaction,
        brand(
          '🧪 Server Diagnostics',
          [
            `**Guild:** ${guild.name} (\`${guild.id}\`)`,
            `**Ticket coverage:** \`${diag.coverageLevel}\` (${diag.accessibleCount} accessible / ${diag.inaccessibleCount} inaccessible)`,
            `**Adapters:** ${diag.adapterReports.map((a) => `${a.adapterId} (${a.observableLimitations.length} limitations)`).join(', ')}`,
            `**Guild Members intent:** ${container.config.enableGuildMembersIntent ? '✅' : '❌ (+ required for staff discovery)'}`,
            `**Message Content intent:** ${container.config.enableMessageContentIntent ? '✅ (transcript text available)' : '⚠️ disabled — transcripts store metadata only'}`,
            `**Database:** ${integrity.ok ? '✅ integrity OK' : '❌ integrity errors'} · ${container.db.driverNameUsed}`,
            `**Backups:** ${backups.length}`,
            `**Auto-claim:** ${container.settings.getNumber('ticket_auto_claim_minutes')}m`,
          ].join('\n'),
          diag.coverageLevel === 'FULL' ? 'success' : 'warning',
        ),
      );
    },
  },
];
