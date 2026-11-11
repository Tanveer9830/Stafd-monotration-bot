import { ChannelType, ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { ALL_FEATURE_KEYS, FEATURE_LABELS, FeatureKey, LocalPermissionTier } from '../types/domain';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { SlashCommandModule } from './types';

export const settingsCommand: SlashCommandModule = {
  name: 'settings',
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('Configure local server thresholds, features, alerts, reviewer permissions, leave & audit logs')
    .addSubcommand((sub) =>
      sub
        .setName('inactivity')
        .setDescription('Configure inactivity thresholds & scheduled scan interval within Global Owner bounds')
        .addIntegerOption((opt) => opt.setName('at_risk_hours').setDescription('At-Risk threshold hours (default 24)'))
        .addIntegerOption((opt) => opt.setName('inactive_hours').setDescription('Inactive review threshold hours (default 48)'))
        .addIntegerOption((opt) => opt.setName('escalation_hours').setDescription('Escalation threshold hours (default 72)'))
        .addIntegerOption((opt) => opt.setName('baseline_hours').setDescription('New staff baseline observation hours (default 24)'))
        .addIntegerOption((opt) => opt.setName('scan_interval_minutes').setDescription('Scheduled scan interval in minutes (default 360)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('features')
        .setDescription('Enable, disable, or inspect local server feature switches')
        .addStringOption((opt) =>
          opt
            .setName('feature')
            .setDescription('Feature switch to toggle')
            .addChoices(...ALL_FEATURE_KEYS.map((k) => ({ name: `${FEATURE_LABELS[k]} (${k})`, value: k }))),
        )
        .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable (true) or disable (false)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('alerts')
        .setDescription('Configure management alert, audit log, fallback review, and support work channels')
        .addChannelOption((opt) =>
          opt.setName('alert_channel').setDescription('Management alert channel').addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt.setName('fallback_review_channel').setDescription('Fallback channel if reviewer DMs fail').addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt.setName('log_channel').setDescription('Server audit log channel').addChannelTypes(ChannelType.GuildText),
        )
        .addChannelOption((opt) =>
          opt.setName('add_support_channel').setDescription('Add observable support work channel').addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('permissions')
        .setDescription('Configure explicit User ID & Role ID Co-Owners and Management Reviewers')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Permission assignment action')
            .setRequired(true)
            .addChoices(
              { name: 'List Assignments', value: 'list' },
              { name: 'Grant User Permission', value: 'grant_user' },
              { name: 'Grant Role Permission', value: 'grant_role' },
              { name: 'Revoke User Permission', value: 'revoke_user' },
              { name: 'Revoke Role Permission', value: 'revoke_role' },
            ),
        )
        .addStringOption((opt) =>
          opt
            .setName('tier')
            .setDescription('Permission tier (for grant actions)')
            .addChoices(
              { name: 'Co-Owner (Approve, Leave, Reports, Config)', value: 'CO_OWNER' },
              { name: 'Management Reviewer (Approve, Leave, Reports)', value: 'MANAGEMENT_REVIEWER' },
              { name: 'Leave Manager (Leave & Reports)', value: 'LEAVE_MANAGER' },
              { name: 'Report Viewer (Read-only Reports)', value: 'REPORT_VIEWER' },
            ),
        )
        .addUserOption((opt) => opt.setName('user').setDescription('Target user (for grant_user / revoke_user)'))
        .addRoleOption((opt) => opt.setName('role').setDescription('Target role (for grant_role / revoke_role)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('leave')
        .setDescription('Complete approved leave management (submit, approve, reject, cancel, active, history)')
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('Leave management operation')
            .setRequired(true)
            .addChoices(
              { name: 'View Active & Pending Leave', value: 'active' },
              { name: 'View Historical Leave', value: 'history' },
              { name: 'Submit Leave Request', value: 'submit' },
              { name: 'Approve Leave Request', value: 'approve' },
              { name: 'Reject Leave Request', value: 'reject' },
              { name: 'Cancel Leave', value: 'cancel' },
            ),
        )
        .addUserOption((opt) => opt.setName('staff').setDescription('Target staff member (for submit or filter)'))
        .addStringOption((opt) => opt.setName('leave_id').setDescription('Leave ID (LVE-... for approve/reject/cancel)'))
        .addStringOption((opt) => opt.setName('start_date').setDescription('ISO start date YYYY-MM-DD (for submit)'))
        .addStringOption((opt) => opt.setName('end_date').setDescription('ISO end date YYYY-MM-DD (for submit)'))
        .addStringOption((opt) => opt.setName('reason').setDescription('Reason or decision note')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('logs')
        .setDescription('View guild-isolated server audit logs')
        .addIntegerOption((opt) => opt.setName('limit').setDescription('Entries to show (1-25)')),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('Settings commands must be executed inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'inactivity') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'SETTINGS_INACTIVITY');
      const atRiskHours = interaction.options.getInteger('at_risk_hours', false) ?? undefined;
      const inactiveHours = interaction.options.getInteger('inactive_hours', false) ?? undefined;
      const escalationHours = interaction.options.getInteger('escalation_hours', false) ?? undefined;
      const observationBaselineHours = interaction.options.getInteger('baseline_hours', false) ?? undefined;
      const scanIntervalMinutes = interaction.options.getInteger('scan_interval_minutes', false) ?? undefined;

      const updated = container.guildConfig.updateInactivityThresholds(ctx.guildId, ctx.userId, {
        atRiskHours,
        inactiveHours,
        escalationHours,
        observationBaselineHours,
        scanIntervalMinutes,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('scanning')} Server Inactivity Thresholds Updated`,
        tone: 'success',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: '🟡 At-Risk Threshold', value: `**${updated.at_risk_hours} hours**`, inline: true },
        { name: '🔴 Inactive Review Threshold', value: `**${updated.inactive_hours} hours**`, inline: true },
        { name: '🚨 Escalation Threshold', value: `**${updated.escalation_hours} hours**`, inline: true },
        { name: '🆕 New Staff Baseline', value: `${updated.observation_baseline_hours} hours`, inline: true },
        { name: '⏱️ Scheduled Scan Interval', value: `${updated.scan_interval_minutes} minutes`, inline: true },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'features') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'SETTINGS_FEATURES');
      const feature = interaction.options.getString('feature', false) as FeatureKey | null;
      const enabled = interaction.options.getBoolean('enabled', false);

      if (feature && enabled !== null) {
        container.features.setGuildFeature(ctx.guildId, ctx.userId, feature, enabled);
      }

      const list = container.features.listGuildFeatures(ctx.guildId);
      const embed = createBrandEmbed({
        title: `${emojis.get('premium')} Server Feature Switches`,
        tone: 'purple',
        subtitle: interaction.guild.name,
        description: list
          .map((f) => {
            const state = f.globallyDisabled
              ? '🔒 **Globally Locked**'
              : f.effectiveEnabled
                ? '🟢 **Enabled**'
                : '⚪ **Disabled**';
            return `${state} — \`${f.key}\` (${f.label})`;
          })
          .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'alerts') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'SETTINGS_ALERTS');
      const alertCh = interaction.options.getChannel('alert_channel', false);
      const fallbackCh = interaction.options.getChannel('fallback_review_channel', false);
      const logCh = interaction.options.getChannel('log_channel', false);
      const supportCh = interaction.options.getChannel('add_support_channel', false);

      const current = container.guildConfig.getGuildConfigOrThrow(ctx.guildId);
      let supportIds: string[] = [];
      try {
        supportIds = JSON.parse(current.support_work_channel_ids_json) as string[];
      } catch {
        supportIds = [];
      }
      if (supportCh && !supportIds.includes(supportCh.id)) {
        supportIds.push(supportCh.id);
      }

      const updated = container.guildConfig.updateGuildChannels(ctx.guildId, ctx.userId, {
        alertChannelId: alertCh ? alertCh.id : undefined,
        fallbackReviewChannelId: fallbackCh ? fallbackCh.id : undefined,
        logChannelId: logCh ? logCh.id : undefined,
        supportWorkChannelIds: supportCh ? supportIds : undefined,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('notifications')} Alert & Routing Channels Configured`,
        tone: 'cyan',
        subtitle: interaction.guild.name,
      }).addFields(
        { name: 'Alert Channel', value: updated.alert_channel_id ? `<#${updated.alert_channel_id}>` : 'Not Set', inline: true },
        { name: 'Fallback Review Channel', value: updated.fallback_review_channel_id ? `<#${updated.fallback_review_channel_id}>` : 'Not Set', inline: true },
        { name: 'Audit Log Channel', value: updated.log_channel_id ? `<#${updated.log_channel_id}>` : 'Not Set', inline: true },
        {
          name: 'Support Work Channels',
          value: supportIds.length > 0 ? supportIds.map((id) => `<#${id}>`).join(', ') : 'None configured',
          inline: false,
        },
      );
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (sub === 'permissions') {
      const action = interaction.options.getString('action', true);
      if (action === 'list') {
        container.permissions.assertGuildCapability(ctx, 'canViewReports', 'SETTINGS_PERMISSIONS_LIST');
        const list = container.permissions.listGuildPermissionAssignments(ctx.guildId);
        const embed = createBrandEmbed({
          title: `${emojis.get('security')} Configured Reviewer & Management Assignments (${list.length})`,
          tone: 'purple',
          subtitle: interaction.guild.name,
          description:
            list.length === 0
              ? 'Only Global Owner and Discord Server Owner are currently configured.'
              : list
                  .map(
                    (a) =>
                      `• \`${a.target_type}\` ${a.target_type === 'USER' ? `<@${a.target_id}>` : `<@&${a.target_id}>`} (\`${a.target_id}\`) — **${a.permission_level}**`,
                  )
                  .join('\n'),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'grant_user' || action === 'grant_role') {
        const tier = interaction.options.getString('tier', false) as LocalPermissionTier | null;
        if (!tier) {
          throw new Error('Please specify `tier` (CO_OWNER, MANAGEMENT_REVIEWER, LEAVE_MANAGER, REPORT_VIEWER).');
        }
        if (action === 'grant_user') {
          const u = interaction.options.getUser('user', false);
          if (!u) throw new Error('Please specify `user` for grant_user.');
          const saved = container.permissions.setGuildPermissionAssignment(ctx, {
            targetType: 'USER',
            targetId: u.id,
            permissionLevel: tier,
          });
          const embed = createBrandEmbed({
            title: `${emojis.get('security')} User Permission Assigned`,
            tone: 'success',
            description: `Granted **${saved.permission_level}** to <@${saved.target_id}> (\`${saved.target_id}\`).`,
          });
          await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
          return;
        }

        const r = interaction.options.getRole('role', false);
        if (!r) throw new Error('Please specify `role` for grant_role.');
        const saved = container.permissions.setGuildPermissionAssignment(ctx, {
          targetType: 'ROLE',
          targetId: r.id,
          permissionLevel: tier,
        });
        const embed = createBrandEmbed({
          title: `${emojis.get('security')} Role Permission Assigned`,
          tone: 'success',
          description: `Granted **${saved.permission_level}** to <@&${saved.target_id}> (\`${saved.target_id}\`).`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'revoke_user') {
        const u = interaction.options.getUser('user', false);
        if (!u) throw new Error('Please specify `user` for revoke_user.');
        const removed = container.permissions.removeGuildPermissionAssignment(ctx, 'USER', u.id);
        const embed = createBrandEmbed({
          title: removed ? `${emojis.get('success')} Permission Revoked` : `${emojis.get('warning')} Not Found`,
          tone: removed ? 'success' : 'warning',
          description: removed ? `Revoked local permission assignment for <@${u.id}>.` : `No assignment existed for <@${u.id}>.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'revoke_role') {
        const r = interaction.options.getRole('role', false);
        if (!r) throw new Error('Please specify `role` for revoke_role.');
        const removed = container.permissions.removeGuildPermissionAssignment(ctx, 'ROLE', r.id);
        const embed = createBrandEmbed({
          title: removed ? `${emojis.get('success')} Role Permission Revoked` : `${emojis.get('warning')} Not Found`,
          tone: removed ? 'success' : 'warning',
          description: removed ? `Revoked local permission assignment for <@&${r.id}>.` : `No assignment existed for <@&${r.id}>.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    }

    if (sub === 'leave') {
      const action = interaction.options.getString('action', true);
      const staffUser = interaction.options.getUser('staff', false);
      const leaveId = interaction.options.getString('leave_id', false)?.trim();
      const startDate = interaction.options.getString('start_date', false)?.trim();
      const endDate = interaction.options.getString('end_date', false)?.trim();
      const reason = interaction.options.getString('reason', false) ?? '';

      if (action === 'active' || action === 'history') {
        container.permissions.assertGuildCapability(ctx, 'canViewReports', 'SETTINGS_LEAVE_VIEW');
        const list = container.leave.listGuildLeave(ctx.guildId, {
          activeOnly: action === 'active',
          staffUserId: staffUser?.id,
          limit: 20,
        });
        const embed = createBrandEmbed({
          title: `${emojis.get('active')} ${action === 'active' ? 'Active & Pending' : 'Historical'} Staff Leave (${list.length})`,
          tone: 'cyan',
          subtitle: interaction.guild.name,
          description:
            list.length === 0
              ? 'No matching leave records.'
              : list
                  .map(
                    (l) =>
                      `• \`${l.leave_id}\` — <@${l.staff_user_id}> [\`${l.status}\`]\n  Window: **${l.start_at.slice(0, 10)} → ${l.end_at.slice(0, 10)}** | Reason: *${l.reason}*`,
                  )
                  .join('\n\n'),
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'submit') {
        const perms = container.permissions.evaluateGuildPermissions(ctx);
        const targetStaffId = staffUser?.id ?? ctx.userId;
        if (targetStaffId !== ctx.userId && !perms.canManageLeave) {
          throw new Error('Only authorized leave managers can submit leave on behalf of another staff member.');
        }
        if (!startDate || !endDate) {
          throw new Error('Please provide `start_date` and `end_date` (YYYY-MM-DD).');
        }
        const created = container.leave.submitLeaveRequest({
          guildId: ctx.guildId,
          staffUserId: targetStaffId,
          requestedById: ctx.userId,
          reason,
          startAt: startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`,
          endAt: endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`,
          autoApproveById: perms.canManageLeave ? ctx.userId : null,
        });

        const embed = createBrandEmbed({
          title: `${emojis.get('success')} Leave Record Created — \`${created.leave_id}\``,
          tone: 'success',
          description:
            `Staff: <@${created.staff_user_id}> | Status: **\`${created.status}\`**\n` +
            `Window: **${created.start_at.slice(0, 10)} → ${created.end_at.slice(0, 10)}**`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      container.permissions.assertGuildCapability(ctx, 'canManageLeave', `SETTINGS_LEAVE_${action.toUpperCase()}`);
      if (!leaveId) {
        throw new Error('Please provide `leave_id` (LVE-...) for approve/reject/cancel.');
      }

      if (action === 'approve') {
        const updated = container.leave.approveLeave(ctx.guildId, leaveId, ctx.userId, reason);
        const embed = createBrandEmbed({
          title: `${emojis.get('approval')} Leave Approved — \`${updated.leave_id}\``,
          tone: 'success',
          description: `Approved leave for <@${updated.staff_user_id}> (Status: \`${updated.status}\`). Inactivity monitoring is automatically paused during this period.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'reject') {
        const updated = container.leave.rejectLeave(ctx.guildId, leaveId, ctx.userId, reason);
        const embed = createBrandEmbed({
          title: `${emojis.get('rejection')} Leave Request Rejected — \`${updated.leave_id}\``,
          tone: 'neutral',
          description: `Rejected leave request for <@${updated.staff_user_id}>.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'cancel') {
        const updated = container.leave.cancelLeave(ctx.guildId, leaveId, ctx.userId, reason);
        const embed = createBrandEmbed({
          title: `${emojis.get('warning')} Leave Cancelled — \`${updated.leave_id}\``,
          tone: 'warning',
          description: `Cancelled leave \`${updated.leave_id}\` for <@${updated.staff_user_id}>. Normal monitoring resumes.`,
        });
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }
    }

    if (sub === 'logs') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'SETTINGS_LOGS');
      const limit = Math.min(25, Math.max(1, interaction.options.getInteger('limit', false) ?? 12));
      const logs = container.audit.listGuildLogs(ctx.guildId, { limit });

      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Server Audit Logs (${logs.length})`,
        tone: 'midnight',
        subtitle: interaction.guild.name,
        description:
          logs.length === 0
            ? 'No local audit entries recorded yet.'
            : logs
                .map(
                  (l) =>
                    `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — Actor <@${l.actor_user_id}> at ${l.created_at}`,
                )
                .join('\n'),
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  },
};
