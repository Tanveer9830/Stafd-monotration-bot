import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { GlobalOwnerDashboard } from '../../dashboards/GlobalOwnerDashboard';
import { ALL_FEATURE_KEYS, BotAdminScope, FEATURE_LABELS, FeatureKey } from '../../types/domain';
import { assertGlobal, brand, reply } from './shared';
import { CommandOperation } from './types';

const ADMIN_SCOPES: BotAdminScope[] = [
  'VIEW_GLOBAL_STATS',
  'VIEW_GUILDS',
  'INSPECT_DIAGNOSTICS',
  'VIEW_AUDIT_LOGS',
  'REVIEW_CASES',
];

export const OWNER_OPERATIONS: CommandOperation[] = [
  {
    root: 'owner',
    sub: 'panel',
    description: 'Open the Global Owner command center',
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, null, 'OWNER_PANEL');
      const dashboard = new GlobalOwnerDashboard(container);
      const payload = dashboard.render(actorId, 'overview', 0);
      await interaction.reply({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    root: 'owner',
    group: 'admins',
    sub: 'add',
    description: 'Appoint a Global Administrator with explicit scopes (Global Owner only)',
    options: [
      { kind: 'user', name: 'user', description: 'Discord user to appoint', required: true },
      {
        kind: 'string',
        name: 'scopes',
        description: 'Comma-separated scopes: VIEW_GLOBAL_STATS,VIEW_GUILDS,INSPECT_DIAGNOSTICS,VIEW_AUDIT_LOGS,REVIEW_CASES',
      },
      { kind: 'string', name: 'notes', description: 'Optional appointment note' },
    ],
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, null, 'OWNER_ADMINS_ADD');
      const target = interaction.options.getUser('user', true);
      const raw = interaction.options.getString('scopes', false);
      const notes = interaction.options.getString('notes', false) ?? undefined;
      const scopes: BotAdminScope[] = raw
        ? (raw
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter((s): s is BotAdminScope => ADMIN_SCOPES.includes(s as BotAdminScope)))
        : ['VIEW_GUILDS', 'INSPECT_DIAGNOSTICS'];
      if (scopes.length === 0) throw new Error('No valid Global Administrator scopes were supplied.');
      const saved = container.permissions.addBotAdmin(actorId, target.id, target.username, scopes, notes);
      await reply(
        interaction,
        brand(
          '🛡️ Global Administrator Appointed',
          `Appointed **${saved.username}** (\`${saved.user_id}\`).\nScopes: ${saved.scopes.map((s) => `\`${s}\``).join(', ')}\n\nGlobal Administrators never receive Global Owner identity and only get the scopes listed above.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'owner',
    group: 'admins',
    sub: 'remove',
    description: 'Revoke a Global Administrator (Global Owner only)',
    options: [{ kind: 'user', name: 'user', description: 'Global Administrator to revoke', required: true }],
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, null, 'OWNER_ADMINS_REMOVE');
      const target = interaction.options.getUser('user', true);
      const removed = container.permissions.removeBotAdmin(actorId, target.id);
      // Also revoke any website-level global assignment for immediate effect.
      for (const assignment of container.webRoles.listAssignments({ userId: target.id })) {
        if (assignment.role === 'GLOBAL_ADMIN') {
          container.webRoles.revokeAssignment(
            { userId: actorId, username: 'Global Owner', kind: 'GLOBAL_OWNER', scopes: [] },
            assignment.assignment_id,
            'Global Owner revoked administrator access',
          );
        }
      }
      await reply(
        interaction,
        brand(
          removed ? '✅ Global Administrator Revoked' : '⚠️ Not Found',
          removed
            ? `Revoked Global Administrator privileges from **${target.username}** (\`${target.id}\`).`
            : `\`${target.id}\` was not an active Global Administrator.`,
          removed ? 'success' : 'warning',
        ));
    },
  },
  {
    root: 'owner',
    group: 'admins',
    sub: 'list',
    description: 'List appointed Global Administrators and their scopes',
    handler: async ({ interaction, container }) => {
      assertGlobal(interaction, container, null, 'OWNER_ADMINS_LIST');
      const admins = container.permissions.listBotAdmins();
      const webAdmins = container.webRoles.listAssignments({ guildId: null });
      const lines = [
        ...admins.map((a) => `• **${a.username}** (\`${a.user_id}\`) — ${a.scopes.map((s) => `\`${s}\``).join(', ') || 'No scopes'}`),
        ...webAdmins
          .filter((a) => a.role === 'GLOBAL_ADMIN')
          .map((a) => `• **${a.username}** (\`${a.user_id}\`) — website: ${a.permissions.map((p) => `\`${p}\``).join(', ')}`),
      ];
      await reply(
        interaction,
        brand(
          `🛡️ Global Administrators (${lines.length})`,
          lines.length ? lines.join('\n') : 'No subordinate Global Administrators are appointed.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'owner',
    sub: 'guilds',
    description: 'List every registered Discord server',
    handler: async ({ interaction, container }) => {
      assertGlobal(interaction, container, 'GLOBAL_VIEW_ALL', 'OWNER_GUILDS');
      const guilds = container.guildConfig.listAllGuilds();
      await reply(
        interaction,
        brand(
          `👑 Registered Discord Servers (${guilds.length})`,
          guilds.length
            ? guilds
                .slice(0, 25)
                .map((g) => `• **${g.guild_name}** (\`${g.guild_id}\`) — Owner \`${g.owner_id}\` — ${g.at_risk_hours}h/${g.inactive_hours}h/${g.escalation_hours}h`)
                .join('\n')
            : 'No servers registered yet.',
          'purple',
        ),
      );
    },
  },
  {
    root: 'owner',
    sub: 'guild-info',
    description: 'Inspect one registered server in detail',
    options: [{ kind: 'string', name: 'guild_id', description: 'Target Discord server ID', required: true }],
    handler: async ({ interaction, container }) => {
      assertGlobal(interaction, container, 'GLOBAL_VIEW_ALL', 'OWNER_GUILD_INFO');
      const guildId = interaction.options.getString('guild_id', true).trim();
      const cfg = container.guildConfig.getGuildConfigOrThrow(guildId);
      const staff = container.roster.listStaffProfiles(guildId, { onlyActiveStaff: true });
      const tickets = container.tickets.getGuildTicketSummary(guildId);
      const reviews = container.reviews.listGuildReviews(guildId, { pendingOnly: true });
      const scans = container.staffDiscovery.listScanHistory(guildId, 1);
      await reply(
        interaction,
        brand(
          `👑 Server Inspection — ${cfg.guild_name}`,
          [
            `**Guild ID:** \`${cfg.guild_id}\``,
            `**Discord Owner:** \`${cfg.owner_id}\``,
            `**Active Staff:** ${staff.length}`,
            `**Tickets:** ${tickets.totalTickets} (${tickets.openTickets} open / ${tickets.resolvedTickets} resolved)`,
            `**Pending Reviews:** ${reviews.length}`,
            `**Thresholds:** ${cfg.at_risk_hours}h / ${cfg.inactive_hours}h / ${cfg.escalation_hours}h`,
            `**Last Scan:** ${scans[0]?.completed_at ?? 'none'}`,
          ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'owner',
    sub: 'global-stats',
    description: 'View cross-server platform analytics',
    options: [
      {
        kind: 'string',
        name: 'export',
        description: 'Optional export format',
        choices: [
          { name: 'PNG report', value: 'png' },
          { name: 'CSV data', value: 'csv' },
          { name: 'PDF report', value: 'pdf' },
        ],
      },
    ],
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, 'GLOBAL_ANALYTICS', 'OWNER_GLOBAL_STATS');
      const hasScope = container.authz.hasGlobalScope(actorId, 'GLOBAL_ANALYTICS');
      const report = container.analytics.buildGlobalAnalytics(actorId, hasScope);
      const format = interaction.options.getString('export', false);
      const files: AttachmentBuilder[] = [];
      if (format === 'png') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGlobalPngReport(report), { name: 'global-report.png' }));
      } else if (format === 'csv') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGlobalCsvReport(report), { name: 'global-report.csv' }));
      } else if (format === 'pdf') {
        files.push(new AttachmentBuilder(await container.reportExporter.exportGlobalPdfReport(report), { name: 'global-report.pdf' }));
      }
      await interaction.reply({
        embeds: [
          brand(
            '📊 Global Platform Analytics',
            [
              `**Registered Servers:** ${report.totalGuilds}`,
              `**Configured Staff:** ${report.totalStaff}`,
              `**Active / At-Risk / Inactive:** ${report.statusBreakdown.ACTIVE} / ${report.statusBreakdown.AT_RISK} / ${report.statusBreakdown.INACTIVE}`,
              `**Tickets Monitored:** ${report.totalTicketsMonitored}`,
              `**Tickets Handled:** ${report.totalTicketsHandled}`,
              `**Pending Reviews:** ${report.pendingReviews}`,
              `**Active Warnings:** ${report.totalWarnings}`,
            ].join('\n'),
            'primary',
          ),
        ],
        files,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    root: 'owner',
    sub: 'audit',
    description: 'Inspect platform and per-server audit logs',
    options: [
      { kind: 'string', name: 'guild_id', description: 'Optional guild filter' },
      { kind: 'integer', name: 'limit', description: 'Rows (1-25)', minValue: 1, maxValue: 25 },
    ],
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, 'GLOBAL_VIEW_AUDIT', 'OWNER_AUDIT');
      const guildId = interaction.options.getString('guild_id', false) ?? undefined;
      const limit = interaction.options.getInteger('limit', false) ?? 12;
      const logs = container.audit.listGlobalLogs(actorId, true, { guildId, limit });
      await reply(
        interaction,
        brand(
          `🗄️ Global Audit Logs (${logs.length})`,
          logs.length
            ? logs
                .map((l) => `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — \`${l.actor_user_id}\` (${l.guild_id ?? 'GLOBAL'}) ${l.created_at}`)
                .join('\n')
            : 'No matching audit entries.',
          'midnight',
        ),
      );
    },
  },
  {
    root: 'owner',
    sub: 'features',
    description: 'Inspect or change global feature restrictions',
    options: [
      {
        kind: 'string',
        name: 'feature',
        description: 'Feature key',
        choices: ALL_FEATURE_KEYS.map((k) => ({ name: FEATURE_LABELS[k], value: k })),
      },
      { kind: 'boolean', name: 'allowed', description: 'True = allowed, False = globally locked off' },
    ],
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, null, 'OWNER_FEATURES');
      const feature = interaction.options.getString('feature', false) as FeatureKey | null;
      const allowed = interaction.options.getBoolean('allowed', false);
      if (feature && allowed !== null) {
        if (!ALL_FEATURE_KEYS.includes(feature)) throw new Error(`Unknown feature key "${feature}".`);
        container.features.setGlobalFeatureRestriction(actorId, feature, allowed);
      }
      const disabled = container.features.getGloballyDisabledFeatures();
      await reply(
        interaction,
        brand(
          '💎 Global Feature Restrictions',
          ALL_FEATURE_KEYS.map((k) => `${disabled.has(k) ? '🔒 LOCKED OFF' : '🟢 ALLOWED'} — \`${k}\` (${FEATURE_LABELS[k]})`).join('\n'),
          'purple',
        ),
      );
    },
  },
  {
    root: 'owner',
    sub: 'backup',
    description: 'List or create verified database backups',
    options: [
      {
        kind: 'string',
        name: 'action',
        description: 'Backup action',
        required: true,
        choices: [
          { name: 'List backups', value: 'list' },
          { name: 'Create backup', value: 'create' },
        ],
      },
      { kind: 'string', name: 'label', description: 'Optional backup label' },
    ],
    handler: async ({ interaction, container, actorId }) => {
      assertGlobal(interaction, container, 'GLOBAL_BACKUP', 'OWNER_BACKUP');
      const action = interaction.options.getString('action', true);
      if (action === 'create') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const label = interaction.options.getString('label', false) ?? 'manual';
        const backup = await container.backups.createBackup(label);
        container.audit.log({
          guildId: null,
          actorUserId: actorId,
          actionCategory: 'BACKUP',
          actionType: 'BACKUP_CREATED',
          targetType: 'BACKUP',
          targetId: backup.filename,
          metadata: { sizeBytes: backup.sizeBytes },
        });
        await interaction.editReply({
          embeds: [
            brand(
              '💾 Verified Backup Created',
              `**File:** \`${backup.filename}\`\n**Size:** ${(backup.sizeBytes / 1024).toFixed(1)} KB\n**Integrity:** ${backup.integrityOk ? '✅ verified' : '❌ failed'}`,
              backup.integrityOk ? 'success' : 'danger',
            ),
          ],
        });
        return;
      }
      const list = container.backups.listBackups();
      await reply(
        interaction,
        brand(
          `💾 Database Backups (${list.length})`,
          list.length
            ? list
                .slice(0, 20)
                .map((b) => `• \`${b.filename}\` — ${(b.sizeBytes / 1024).toFixed(1)} KB — ${b.createdAt}`)
                .join('\n')
            : 'No backups found. Create one with `/owner backup action:create`.',
          'midnight',
        ),
      );
    },
  },
];
