import { AttachmentBuilder, MessageFlags } from 'discord.js';
import { StaffRoleCategory } from '../../types/domain';
import { StaffMonitoringStatus } from '../../config/theme';
import { buildDiscoveryReportEmbed, buildStaffDiscoveryPayload, confirmStaffDiscovery } from '../staffDiscoveryUi';
import { collectLiveGuildTelemetry } from '../../utils/discordContext';
import {
  assertLocal,
  brand,
  formatDuration,
  formatHours,
  reply,
  replyWith,
  requireGuild,
  resolveAccess,
  statusIcon,
  truncate,
} from './shared';
import { CommandOperation } from './types';

const CATEGORY_CHOICES = [
  'TRIAL_STAFF',
  'JUNIOR_STAFF',
  'STAFF',
  'SENIOR_STAFF',
  'SUPPORT_TEAM',
  'HELPER',
  'MODERATOR',
  'SENIOR_MODERATOR',
  'ADMINISTRATOR',
  'MANAGEMENT',
  'CO_OWNER',
  'CUSTOM',
].map((c) => ({ name: c, value: c }));

export const STAFF_OPERATIONS: CommandOperation[] = [
  {
    root: 'staff',
    sub: 'setup',
    description: 'Show staff monitoring setup status and next steps',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'STAFF_SETUP');
      const roles = container.roster.listStaffRoles(access.guildId, true);
      const staff = container.roster.listStaffProfiles(access.guildId, { onlyActiveStaff: true });
      await replyWith(
        interaction,
        brand(
          '🛰️ Staff Monitoring Setup',
          roles.length
            ? [
                `**Configured staff roles:** ${roles.length}`,
                `**Registered staff:** ${staff.length}`,
                `**Members intent:** ${container.config.enableGuildMembersIntent ? '✅ enabled' : '❌ disabled'}`,
                '',
                'Use `/staff add` to configure additional roles with the multi-page role selector, then `/staff sync` to refresh the roster.',
              ].join('\n')
            : [
                'No staff roles configured yet.',
                '',
                '**Quick start:**',
                '1. Run `/staff add` and select every staff role (multi-page selector).',
                '2. Confirm the scan — every member holding a selected role is registered.',
                '3. Enable the **Server Members Intent** in the Discord Developer Portal.',
                '4. Configure ticket monitoring with `/ticket setup`.',
                '5. Run `/staff sync` and `/scan now`.',
              ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'staff',
    sub: 'add',
    description: 'Discover staff automatically from one or more Discord roles',
    options: [
      {
        kind: 'string',
        name: 'category',
        description: 'Primary staff category for newly registered roles (default STAFF)',
        choices: CATEGORY_CHOICES,
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_ADD');
      const guild = requireGuild(interaction);
      const category = (interaction.options.getString('category', false) ?? 'STAFF') as StaffRoleCategory;
      const session = container.discoverySessions.create(guild.id, access.userId, category);
      const payload = buildStaffDiscoveryPayload(guild, session);
      await replyWith(interaction, payload.embeds[0], payload.components);
    },
  },
  {
    root: 'staff',
    sub: 'remove',
    description: 'Remove a member from the monitored staff roster (history is preserved)',
    options: [{ kind: 'user', name: 'user', description: 'Staff member to remove', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_REMOVE');
      const target = interaction.options.getUser('user', true);
      const profile = container.roster.getStaffProfile(access.guildId, target.id);
      if (!profile) throw new Error(`\`${target.id}\` is not registered as staff in this server.`);
      if (profile.is_currently_staff === 0) {
        await reply(interaction, brand('⚠️ Already Excluded', `**${target.username}** is already outside the active staff roster.`, 'warning'));
        return;
      }
      container.db.run(
        `UPDATE staff_profiles SET is_currently_staff = 0, role_removed_at = ?, updated_at = ?
         WHERE guild_id = ? AND user_id = ?`,
        [new Date().toISOString(), new Date().toISOString(), access.guildId, target.id],
      );
      container.db.run(
        `INSERT INTO staff_role_history (guild_id, user_id, change_type, previous_roles_json, new_roles_json, detected_at)
         VALUES (?, ?, 'REMOVED', ?, '[]', ?)`,
        [access.guildId, target.id, profile.active_role_ids_json, new Date().toISOString()],
      );
      container.audit.log({
        guildId: access.guildId,
        actorUserId: access.userId,
        actionCategory: 'ROSTER',
        actionType: 'STAFF_MEMBER_REMOVED',
        targetType: 'USER',
        targetId: target.id,
        before: profile,
      });
      await reply(
        interaction,
        brand(
          '✅ Removed From Staff Roster',
          `**${target.username}** (\`${target.id}\`) is no longer monitored as active staff. History, tickets and warnings were preserved.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'staff',
    sub: 'sync',
    description: 'Synchronize the complete Discord member roster with configured staff roles',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_SYNC');
      const guild = requireGuild(interaction);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const telemetry = await collectLiveGuildTelemetry(guild, container);
      const result = container.roster.syncGuildRoster(access.guildId, telemetry.liveMembers, {
        forceEvenIfDisabled: true,
      });
      const scanId = container.staffDiscovery.recordScan({
        guildId: access.guildId,
        scanType: 'STAFF',
        trigger: 'MANUAL',
        actorUserId: access.userId,
        membersScanned: telemetry.liveMembers.length,
        staffDiscovered: result.activeStaffCount,
        newlyRegistered: result.newlyRegistered.length,
        existingProfiles: result.activeStaffCount - result.newlyRegistered.length,
        coverageLevel: telemetry.liveMembers.length > 0 ? 'FULL' : 'UNAVAILABLE',
      });
      await interaction.editReply({
        embeds: [
          brand(
            '✅ Staff Roster Synchronized',
            [
              `**Scan:** \`${scanId}\``,
              `**Members scanned:** ${telemetry.liveMembers.length}`,
              `**Configured roles:** ${result.totalConfiguredRoles}`,
              `**Active staff:** ${result.activeStaffCount}`,
              `**Newly registered:** ${result.newlyRegistered.length}`,
              `**Rejoined:** ${result.rejoinedStaff.length}`,
              `**Role removed:** ${result.removedFromStaff.length}`,
              `**Left guild:** ${result.leftGuildStaff.length}`,
            ].join('\n'),
            'success',
          ),
        ],
      });
    },
  },
  {
    root: 'staff',
    sub: 'scan',
    description: 'Run a manual staff monitoring scan with configured thresholds',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_SCAN');
      const guild = requireGuild(interaction);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const telemetry = await collectLiveGuildTelemetry(guild, container);
      const report = await container.scanner.scanGuildRoster(access.guildId, {
        trigger: 'MANUAL',
        actorUserId: access.userId,
        liveMembers: telemetry.liveMembers,
      });
      container.staffDiscovery.recordScan({
        guildId: access.guildId,
        scanType: 'STAFF',
        trigger: 'MANUAL',
        actorUserId: access.userId,
        membersScanned: telemetry.liveMembers.length,
        staffDiscovered: report.totalStaffScanned,
        coverageLevel: report.coverageLevel,
      });
      await interaction.editReply({
        embeds: [
          brand(
            '🛰️ Staff Scan Completed',
            [
              `**Coverage:** \`${report.coverageLevel}\``,
              `**Staff scanned:** ${report.totalStaffScanned}`,
              `**Incidents updated:** ${report.incidentsCreatedOrUpdated}`,
              `**Reviews created:** ${report.reviewsCreated}`,
              `**Escalations:** ${report.escalationsTriggered}`,
              `**Status:** 🟢 ${report.statusCounts.ACTIVE} active · 🟡 ${report.statusCounts.AT_RISK} at risk · 🔴 ${report.statusCounts.INACTIVE} inactive · 🔵 ${report.statusCounts.ON_LEAVE} on leave`,
            ].join('\n'),
            'primary',
          ),
        ],
      });
    },
  },
  {
    root: 'staff',
    sub: 'list',
    description: 'List monitored staff and their live monitoring status',
    options: [
      {
        kind: 'string',
        name: 'status',
        description: 'Optional status filter',
        choices: [
          'ACTIVE',
          'AT_RISK',
          'INACTIVE',
          'ON_LEAVE',
          'NEW_STAFF',
          'INSUFFICIENT_WORKLOAD',
          'MONITORING_ERROR',
          'UNKNOWN',
        ].map((s) => ({ name: s, value: s })),
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'STAFF_LIST');
      const status = interaction.options.getString('status', false) as StaffMonitoringStatus | null;
      const staff = container.roster.listStaffProfiles(access.guildId, {
        onlyActiveStaff: true,
        status: status ?? undefined,
        limit: 40,
      });
      await reply(
        interaction,
        brand(
          `👥 Monitored Staff (${staff.length})`,
          staff.length
            ? staff
                .map(
                  (s) =>
                    `${statusIcon(s.monitoring_status)} **${s.display_name}** (\`${s.user_id}\`) — ${s.monitoring_status} · ${s.primary_category} · workload ${s.current_workload} · handled ${s.tickets_handled_count}`,
                )
                .join('\n')
            : 'No staff members match this filter.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'staff',
    sub: 'profile',
    description: 'View a complete staff profile',
    options: [{ kind: 'user', name: 'user', description: 'Staff member', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await resolveAccess(interaction, container);
      const target = interaction.options.getUser('user', true);
      const isSelf = target.id === access.userId;
      if (!isSelf) {
        container.authz.assertLocalScope(access, 'SERVER_VIEW_STAFF', 'STAFF_PROFILE');
      } else if (!access.localScopes.has('STAFF_SELF_VIEW') && !access.localScopes.has('SERVER_VIEW_STAFF')) {
        throw new Error('Access Denied: you may not view staff profiles in this server.');
      }
      const profile = container.roster.getStaffProfile(access.guildId, target.id);
      if (!profile) throw new Error(`No staff profile exists for \`${target.id}\` in this server.`);
      const leave = container.leave.getActiveLeaveForStaff(access.guildId, target.id);
      const warnings = container.warnings.listWarnings(access.guildId, { staffUserId: target.id, onlyActive: true });
      await reply(
        interaction,
        brand(
          `${statusIcon(profile.monitoring_status)} Staff Profile — ${profile.display_name}`,
          [
            `**User:** <@${profile.user_id}> (\`${profile.user_id}\`)`,
            `**Category:** ${profile.primary_category}`,
            `**Status:** ${profile.monitoring_status}`,
            `**Coverage:** ${profile.monitoring_coverage}`,
            `**Currently staff:** ${profile.is_currently_staff ? 'yes' : 'no'}`,
            `**Joined staff:** ${profile.joined_staff_at}`,
            `**Last qualifying work:** ${profile.last_qualifying_work_at ?? '—'}`,
            `**Last ticket activity:** ${profile.last_ticket_activity_at ?? '—'}`,
            `**Workload:** ${profile.current_workload} active · **Handled:** ${profile.tickets_handled_count} · **Resolved:** ${profile.tickets_resolved_count}`,
            `**Avg first response:** ${formatDuration(profile.avg_first_response_sec)}`,
            `**Avg resolution:** ${formatDuration(profile.avg_resolution_sec)}`,
            `**Active warnings:** ${warnings.length}`,
            `**Leave:** ${leave ? `${leave.status} (${leave.start_at.slice(0, 10)} → ${leave.end_at.slice(0, 10)})` : 'none'}`,
          ].join('\n'),
          'primary',
        ),
      );
    },
  },
  {
    root: 'staff',
    sub: 'activity',
    description: 'View a staff member’s latest observable activity events',
    options: [
      { kind: 'user', name: 'user', description: 'Staff member', required: true },
      { kind: 'integer', name: 'limit', description: 'Events to show (1-25)', minValue: 1, maxValue: 25 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'STAFF_ACTIVITY');
      const target = interaction.options.getUser('user', true);
      const limit = interaction.options.getInteger('limit', false) ?? 12;
      const events = container.db.all<{
        event_type: string;
        is_qualifying: number;
        classification_reason: string;
        occurred_at: string;
        ticket_id: string | null;
      }>(
        `SELECT event_type, is_qualifying, classification_reason, occurred_at, ticket_id
         FROM activity_events WHERE guild_id = ? AND user_id = ?
         ORDER BY occurred_at DESC LIMIT ?`,
        [access.guildId, target.id, limit],
      );
      await reply(
        interaction,
        brand(
          `⚡ Activity — ${target.username} (${events.length})`,
          events.length
            ? events
                .map(
                  (e) =>
                    `• ${e.is_qualifying ? '✅' : '⚪'} **${e.event_type}** at ${e.occurred_at}${e.ticket_id ? ` · ticket \`${e.ticket_id}\`` : ''}\n  ${truncate(e.classification_reason, 100)}`,
                )
                .join('\n')
            : 'No observable activity events recorded yet.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'staff',
    sub: 'history',
    description: 'View a staff member’s role and monitoring history',
    options: [{ kind: 'user', name: 'user', description: 'Staff member', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'STAFF_HISTORY');
      const target = interaction.options.getUser('user', true);
      const history = container.roster.getRoleHistory(access.guildId, target.id, 20);
      const profile = container.roster.getStaffProfile(access.guildId, target.id);
      await reply(
        interaction,
        brand(
          `🗄️ Staff History — ${target.username}`,
          [
            `**Profile:** ${profile ? `${profile.monitoring_status}, registered ${profile.first_registered_at}` : 'not registered'}`,
            '',
            history.length
              ? history.map((h) => `• **${h.change_type}** — ${h.detected_at}`).join('\n')
              : 'No role history recorded.',
          ].join('\n'),
          'midnight',
        ),
      );
    },
  },
  {
    root: 'staff',
    group: 'roles',
    sub: 'add',
    description: 'Register a staff role by ID (bypasses the interactive selector)',
    options: [
      { kind: 'role', name: 'role', description: 'Discord staff role', required: true },
      { kind: 'string', name: 'category', description: 'Staff category', required: true, choices: CATEGORY_CHOICES },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_ROLES_ADD');
      const role = interaction.options.getRole('role', true);
      const category = interaction.options.getString('category', true) as StaffRoleCategory;
      const saved = container.roster.addOrUpdateStaffRole(access.guildId, access.userId, {
        roleId: role.id,
        roleName: role.name,
        category,
      });
      await reply(
        interaction,
        brand(
          '✅ Staff Role Registered',
          `**${saved.role_name}** (\`${saved.role_id}\`) — category \`${saved.category}\`.\nRun \`/staff add\` or \`/staff sync\` to register members holding this role.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'staff',
    group: 'roles',
    sub: 'remove',
    description: 'Remove a configured staff role (profiles are preserved)',
    options: [{ kind: 'role', name: 'role', description: 'Configured staff role', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_ROLES_REMOVE');
      const role = interaction.options.getRole('role', true);
      const removed = container.roster.removeStaffRole(access.guildId, access.userId, role.id);
      await reply(
        interaction,
        brand(
          removed ? '✅ Staff Role Removed' : '⚠️ Role Not Configured',
          removed
            ? `Role \`${role.name}\` (\`${role.id}\`) is no longer monitored. Existing profiles and history were preserved.`
            : `Role \`${role.id}\` was not configured for monitoring.`,
          removed ? 'success' : 'warning',
        ),
      );
    },
  },
  {
    root: 'staff',
    group: 'roles',
    sub: 'list',
    description: 'List configured staff roles with role IDs and categories',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'STAFF_ROLES_LIST');
      const roles = container.roster.listStaffRoles(access.guildId);
      await reply(
        interaction,
        brand(
          `🎭 Configured Staff Roles (${roles.length})`,
          roles.length
            ? roles
                .map(
                  (r) =>
                    `• **${r.role_name}** (\`${r.role_id}\`) — ${r.category}${r.custom_at_risk_hours ? ` · at-risk ${r.custom_at_risk_hours}h` : ''}${r.is_monitored ? '' : ' · paused'}`,
                )
                .join('\n')
            : 'No staff roles configured. Use `/staff add` or `/staff roles add`.',
          'purple',
        ),
      );
    },
  },
  {
    root: 'staff',
    group: 'roles',
    sub: 'scan',
    description: 'Audit configured staff roles against live Discord roles and members',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_STAFF', 'STAFF_ROLES_SCAN');
      const guild = requireGuild(interaction);
      const roles = container.roster.listStaffRoles(access.guildId);
      const live = guild.roles?.cache ? new Set([...guild.roles.cache.keys()]) : new Set<string>();
      const missing = roles.filter((r) => live.size > 0 && !live.has(r.role_id));
      const holders: string[] = [];
      for (const role of roles) {
        const count = guild.members?.cache
          ? [...guild.members.cache.values()].filter((m) => m.roles.cache.has(role.role_id)).length
          : 0;
        holders.push(`• **${role.role_name}** — ${count} cached member(s)`);
      }
      const scanId = container.staffDiscovery.recordScan({
        guildId: access.guildId,
        scanType: 'ROLES',
        trigger: 'MANUAL',
        actorUserId: access.userId,
        rolesSelected: roles.map((r) => r.role_id),
        unmatchedRoles: missing.map((m) => m.role_id),
        coverageLevel: live.size ? 'PARTIAL' : 'UNAVAILABLE',
      });
      await reply(
        interaction,
        brand(
          '🛰️ Staff Role Coverage Scan',
          [
            `**Scan:** \`${scanId}\``,
            `**Configured roles:** ${roles.length}`,
            `**Deleted / unmatched roles:** ${missing.length ? missing.map((m) => `\`${m.role_name}\``).join(', ') : 'none'}`,
            '',
            ...holders,
            '',
            '_Counts use cached members. Run `/staff sync` for a full member fetch._',
          ].join('\n'),
          missing.length ? 'warning' : 'success',
        ),
      );
    },
  },
  {
    root: 'staff',
    sub: 'report',
    description: 'Export a staff analytics report (PNG, CSV or PDF)',
    options: [
      {
        kind: 'string',
        name: 'format',
        description: 'Export format',
        required: true,
        choices: [
          { name: 'PNG', value: 'png' },
          { name: 'CSV', value: 'csv' },
          { name: 'PDF', value: 'pdf' },
        ],
      },
      {
        kind: 'string',
        name: 'period',
        description: 'Reporting period',
        choices: [
          { name: 'Daily', value: 'DAILY' },
          { name: 'Weekly', value: 'WEEKLY' },
          { name: 'Monthly', value: 'MONTHLY' },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_EXPORT_REPORTS', 'STAFF_REPORT');
      const format = interaction.options.getString('format', true);
      const period = (interaction.options.getString('period', false) ?? 'WEEKLY') as 'DAILY' | 'WEEKLY' | 'MONTHLY';
      const report = container.analytics.buildGuildAnalytics(access.guildId, { periodType: period });
      const files: AttachmentBuilder[] = [];
      if (format === 'png') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGuildPngReport(report), { name: 'staff-report.png' }));
      } else if (format === 'csv') {
        files.push(new AttachmentBuilder(container.reportExporter.exportGuildCsvReport(report), { name: 'staff-report.csv' }));
      } else {
        files.push(new AttachmentBuilder(await container.reportExporter.exportGuildPdfReport(report), { name: 'staff-report.pdf' }));
      }
      await interaction.reply({
        embeds: [brand('📊 Staff Report Exported', `Period **${period}** · ${report.staffRows.length} staff rows · generated ${report.generatedAt}`, 'primary')],
        files,
        flags: MessageFlags.Ephemeral,
      });
    },
  },
];
