import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonInteraction,
  Guild,
  Interaction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { COMMAND_MAP } from '../commands';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { GlobalDashboardSection, GlobalOwnerDashboard } from '../dashboards/GlobalOwnerDashboard';
import { ServerDashboardSection, ServerManagementDashboard } from '../dashboards/ServerManagementDashboard';
import { ALL_FEATURE_KEYS, FeatureKey } from '../types/domain';
import { ActorGuildContext } from '../services/PermissionService';
import { formatWarningLevelLabel } from '../services/WarningService';
import { buildActorGuildContextFromDiscord, collectLiveGuildTelemetry } from '../utils/discordContext';
import { createBrandEmbed } from '../utils/embeds';
import { logger } from '../utils/logger';

async function resolveActorContextForGuild(
  interaction: { user: { id: string; username: string; tag?: string }; client: { guilds: { cache: Map<string, Guild>; fetch: (id: string) => Promise<Guild> } } },
  guildId: string,
  container: PlatformContainer,
): Promise<ActorGuildContext> {
  let guild: Guild | undefined = interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    try {
      guild = await interaction.client.guilds.fetch(guildId);
    } catch {
      guild = undefined;
    }
  }

  let memberRoleIds: string[] = [];
  let actualOwnerId: string | undefined;

  if (guild) {
    actualOwnerId = guild.ownerId;
    container.guildConfig.ensureGuildRegistered(guild.id, guild.name, guild.ownerId);
    try {
      const member = guild.members.cache.get(interaction.user.id) ?? (await guild.members.fetch(interaction.user.id));
      memberRoleIds = Array.from(member.roles.cache.keys());
    } catch {
      memberRoleIds = [];
    }
  }

  return {
    userId: interaction.user.id,
    userTag: interaction.user.tag ?? interaction.user.username,
    guildId,
    actualGuildOwnerId: actualOwnerId,
    memberRoleIds,
  };
}

export async function routeDiscordInteraction(
  interaction: Interaction,
  container: PlatformContainer,
): Promise<void> {
  const rateLimitMax = container.guildConfig.getGlobalConfig().rate_limit_actions_per_minute;
  const rateCheck = container.rateLimiter.checkAndConsume(interaction.user.id, rateLimitMax);
  if (!rateCheck.allowed) {
    if (interaction.isRepliable()) {
      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Rate Limit Active`,
        tone: 'warning',
        description: `Too many rapid interactions. Please retry in **${rateCheck.retryAfterSeconds}s**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const cmd = COMMAND_MAP.get(interaction.commandName);
      if (!cmd) {
        throw new Error(`Unknown slash command "/${interaction.commandName}".`);
      }
      await cmd.execute(interaction, container);
      return;
    }

    if (interaction.isButton()) {
      await handleButtonInteraction(interaction, container);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenuInteraction(interaction, container);
      return;
    }

    if (interaction.isModalSubmit()) {
      await handleModalSubmitInteraction(interaction, container);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'An unexpected error occurred.';
    logger.warn({ err, userId: interaction.user.id }, 'Handled interaction error');

    if (interaction.isRepliable()) {
      const errEmbed = createBrandEmbed({
        title: `${emojis.get('error')} Operation Rejected`,
        tone: 'danger',
        description: message,
      });
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ embeds: [errEmbed], flags: MessageFlags.Ephemeral }).catch(() => undefined);
      } else {
        await interaction.reply({ embeds: [errEmbed], flags: MessageFlags.Ephemeral }).catch(() => undefined);
      }
    }
  }
}

async function handleButtonInteraction(
  interaction: ButtonInteraction,
  container: PlatformContainer,
): Promise<void> {
  const id = interaction.customId;
  if (!id.startsWith('tsm:')) return;

  // 1. Persistent Review Workflow Buttons (tsm:rev:<action>:<reviewId>)
  if (id.startsWith('tsm:rev:')) {
    const [, , action, reviewId] = id.split(':');
    const review = container.reviews.findReviewGloballyById(reviewId);
    if (!review) {
      throw new Error(`Review \`${reviewId}\` no longer exists.`);
    }

    if (interaction.guildId && interaction.guildId !== review.guild_id) {
      throw new Error('Cross-server interaction blocked by guild isolation policy.');
    }

    const ctx = await resolveActorContextForGuild(interaction as never, review.guild_id, container);
    container.permissions.assertGuildCapability(ctx, 'canApproveWarnings', `REVIEW_BUTTON_${action.toUpperCase()}`);

    if (action === 'approve') {
      const modal = new ModalBuilder()
        .setCustomId(`tsm:rev:modal:approve:${reviewId}`)
        .setTitle(`Approve Warning — ${reviewId}`)
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('reason')
              .setLabel('Official Warning Reason')
              .setStyle(TextInputStyle.Paragraph)
              .setValue(review.proposed_reason ?? 'Verified staff inactivity following full roster scan')
              .setRequired(true),
          ),
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId('note')
              .setLabel('Optional Management Note')
              .setStyle(TextInputStyle.Short)
              .setRequired(false),
          ),
        );
      await interaction.showModal(modal);
      return;
    }

    if (action === 'confirm') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const res = await container.reviews.finalizeWarningConfirmation(
        ctx,
        reviewId,
        interaction.user.username,
      );

      if (!res.warning) {
        const embed = createBrandEmbed({
          title: `${emojis.get('active')} Warning Cancelled by Live Safety Recheck`,
          tone: 'success',
          description: res.autoCancelledReason ?? 'Staff activity resumed before confirmation.',
        });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Warning Issued — \`${res.warning.warning_id}\``,
        tone: res.warning.warning_level >= 3 ? 'danger' : 'warning',
        description:
          `Issued **${formatWarningLevelLabel(res.warning.warning_level)}** to <@${res.warning.staff_user_id}>.\n` +
          `**Approved By:** ${res.warning.approver_display_name} (\`${res.warning.approver_id}\`)\n` +
          `**Staff DM Delivery:** ${res.warning.dm_delivered ? '✅ Delivered' : `⚠️ Failed (${res.warning.dm_error})`}`,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (action === 'abort') {
      container.reviews.abortConfirmation(ctx, reviewId);
      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Confirmation Aborted`,
        tone: 'neutral',
        description: `Returned review \`${reviewId}\` to pending queue without issuing a warning.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === 'reject') {
      const updated = container.reviews.rejectReview(ctx, reviewId, interaction.user.username, 'Rejected via review button');
      const embed = createBrandEmbed({
        title: `${emojis.get('rejection')} Review Rejected — \`${updated.review_id}\``,
        tone: 'neutral',
        description: `Review \`${reviewId}\` rejected. No warning was issued.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === 'later') {
      const updated = container.reviews.deferReviewLater(ctx, reviewId, 12, 'Deferred 12h via review button');
      const embed = createBrandEmbed({
        title: `${emojis.get('loading')} Review Deferred — \`${updated.review_id}\``,
        tone: 'cyan',
        description: `Deferred until **${updated.deferred_until}**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (action === 'excuse') {
      const updated = container.reviews.markReviewExcused(ctx, reviewId, interaction.user.username, 'Marked excused via review button');
      const embed = createBrandEmbed({
        title: `${emojis.get('security')} Marked Excused — \`${updated.review_id}\``,
        tone: 'success',
        description: `Inactivity review for <@${updated.staff_user_id}> has been marked excused.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }
  }

  // 2. Persistent Warning Appeal Button (tsm:wrn:appeal:<warningId>)
  if (id.startsWith('tsm:wrn:appeal:')) {
    const warningId = id.split(':')[3];
    const warning = container.warnings.findWarningGlobally(warningId);
    if (!warning) {
      throw new Error(`Warning \`${warningId}\` not found.`);
    }
    if (warning.staff_user_id !== interaction.user.id) {
      throw new Error('Only the warned staff member can submit an appeal for this warning.');
    }

    const modal = new ModalBuilder()
      .setCustomId(`tsm:wrn:modal:appeal:${warningId}`)
      .setTitle(`Appeal Warning — ${warningId}`)
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('appeal_reason')
            .setLabel('Your Appeal Explanation')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // 3. Global Owner Dashboard Buttons (tsm:god:...)
  if (id.startsWith('tsm:god:')) {
    const dashboard = new GlobalOwnerDashboard(container);
    container.permissions.assertGlobalOwner(interaction.user.id, `GLOBAL_DASHBOARD_BTN:${id}`, interaction.guildId);

    if (id.startsWith('tsm:god:page:')) {
      const [, , , section, pageStr] = id.split(':');
      const payload = dashboard.render(interaction.user.id, section as GlobalDashboardSection, Number(pageStr) || 0);
      await interaction.update({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
      });
      return;
    }

    if (id === 'tsm:god:act:open_add_admin_modal') {
      await interaction.showModal(dashboard.buildAddAdminModal());
      return;
    }
    if (id === 'tsm:god:act:open_remove_admin_modal') {
      await interaction.showModal(dashboard.buildRemoveAdminModal());
      return;
    }
    if (id === 'tsm:god:act:open_feature_modal') {
      await interaction.showModal(dashboard.buildToggleGlobalFeatureModal());
      return;
    }
    if (id === 'tsm:god:act:cycle_policy') {
      dashboard.cycleApprovalPolicy(interaction.user.id);
      const payload = dashboard.render(interaction.user.id, 'security', 0);
      await interaction.update({ embeds: payload.embeds, components: payload.components, files: payload.files });
      return;
    }
    if (id === 'tsm:god:act:toggle_override_lock') {
      dashboard.toggleGuildOverrideLock(interaction.user.id);
      const payload = dashboard.render(interaction.user.id, 'security', 0);
      await interaction.update({ embeds: payload.embeds, components: payload.components, files: payload.files });
      return;
    }
    if (id === 'tsm:god:act:run_due_scans') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const reports = await container.scheduler.runDueTasks();
      const embed = createBrandEmbed({
        title: `${emojis.get('scanning')} Due Scheduled Scans Executed`,
        tone: 'success',
        description: `Completed **${reports.length}** due scheduled guild scan(s).`,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    if (id === 'tsm:god:act:create_backup') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const meta = await container.backups.createBackup('global-owner-manual');
      const embed = createBrandEmbed({
        title: `${emojis.get('database')} Verified Atomic SQLite Backup Created`,
        tone: 'success',
        description: `**Filename:** \`${meta.filename}\`\n**Size:** ${meta.sizeBytes} bytes\n**Integrity Check:** OK`,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }
    if (id.startsWith('tsm:god:act:export_')) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const fmt = id.replace('tsm:god:act:export_', '');
      const report = container.analytics.buildGlobalAnalytics(interaction.user.id);
      let file: AttachmentBuilder;
      if (fmt === 'png') {
        file = new AttachmentBuilder(container.reportExporter.exportGlobalPngReport(report), { name: 'tanveer-global-report.png' });
      } else if (fmt === 'csv') {
        file = new AttachmentBuilder(container.reportExporter.exportGlobalCsvReport(report), { name: 'tanveer-global-report.csv' });
      } else {
        file = new AttachmentBuilder(await container.reportExporter.exportGlobalPdfReport(report), { name: 'tanveer-global-report.pdf' });
      }
      const embed = createBrandEmbed({
        title: `${emojis.get('analytics')} Global Report Exported (${fmt.toUpperCase()})`,
        tone: 'purple',
        description: 'Attached verified cross-server executive report.',
      });
      await interaction.editReply({ embeds: [embed], files: [file] });
      return;
    }
  }

  // 4. Server Management Dashboard Buttons (tsm:srv:...)
  if (id.startsWith('tsm:srv:')) {
    if (!interaction.guild) {
      throw new Error('Server dashboard interactions must occur inside a server.');
    }
    const parts = id.split(':');
    const subKind = parts[2]; // page | act
    const guildId = parts[3];

    if (interaction.guild.id !== guildId) {
      throw new Error('Guild isolation check failed: mismatched server ID.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const dashboard = new ServerManagementDashboard(container);

    if (subKind === 'page') {
      const section = parts[4] as ServerDashboardSection;
      const page = Number(parts[5]) || 0;
      const payload = dashboard.render(ctx, section, page);
      await interaction.update({
        embeds: payload.embeds,
        components: payload.components,
        files: payload.files,
      });
      return;
    }

    if (subKind === 'act') {
      const action = parts[4];
      if (action === 'manual_scan') {
        container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'DASHBOARD_MANUAL_SCAN');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const telemetry = await collectLiveGuildTelemetry(interaction.guild, container);
        const scanRep = await container.scanner.scanGuildRoster(ctx.guildId, {
          trigger: 'MANUAL',
          actorUserId: ctx.userId,
          liveMembers: telemetry.liveMembers,
          livePermissionChecks: telemetry.livePermissionChecks,
          roleHoldersMap: telemetry.roleHoldersMap,
        });
        const embed = createBrandEmbed({
          title: `${emojis.get('scanning')} Roster Scan Completed`,
          tone: 'success',
          description: `Scanned **${scanRep.totalStaffScanned}** staff members (Coverage: \`${scanRep.coverageLevel}\`).`,
        });
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      if (action === 'open_leave_modal') {
        container.permissions.assertGuildCapability(ctx, 'canManageLeave', 'DASHBOARD_LEAVE_MODAL');
        await interaction.showModal(dashboard.buildQuickLeaveModal(ctx.guildId));
        return;
      }

      if (action === 'open_feature_modal') {
        container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'DASHBOARD_FEATURE_MODAL');
        await interaction.showModal(dashboard.buildToggleServerFeatureModal(ctx.guildId));
        return;
      }

      if (action.startsWith('export_')) {
        container.permissions.assertGuildCapability(ctx, 'canViewReports', 'DASHBOARD_EXPORT_REPORT');
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const fmt = action.replace('export_', '');
        const report = container.analytics.buildGuildAnalytics(ctx.guildId, { periodType: 'WEEKLY' });
        let file: AttachmentBuilder;
        if (fmt === 'png') {
          file = new AttachmentBuilder(container.reportExporter.exportGuildPngReport(report), { name: 'tanveer-server-report.png' });
        } else if (fmt === 'csv') {
          file = new AttachmentBuilder(container.reportExporter.exportGuildCsvReport(report), { name: 'tanveer-server-report.csv' });
        } else {
          file = new AttachmentBuilder(await container.reportExporter.exportGuildPdfReport(report), { name: 'tanveer-server-report.pdf' });
        }
        const embed = createBrandEmbed({
          title: `${emojis.get('analytics')} Server Report Exported (${fmt.toUpperCase()})`,
          tone: 'purple',
          subtitle: interaction.guild.name,
          description: 'Attached verified server analytics report.',
        });
        await interaction.editReply({ embeds: [embed], files: [file] });
      }
    }
  }
}

async function handleSelectMenuInteraction(
  interaction: StringSelectMenuInteraction,
  container: PlatformContainer,
): Promise<void> {
  const id = interaction.customId;

  if (id === 'tsm:god:nav') {
    const selected = interaction.values[0] as GlobalDashboardSection;
    const dashboard = new GlobalOwnerDashboard(container);
    const payload = dashboard.render(interaction.user.id, selected, 0);
    await interaction.update({
      embeds: payload.embeds,
      components: payload.components,
      files: payload.files,
    });
    return;
  }

  if (id.startsWith('tsm:srv:nav:')) {
    if (!interaction.guild) {
      throw new Error('Server dashboard navigation requires a guild context.');
    }
    const guildId = id.split(':')[3];
    if (interaction.guild.id !== guildId) {
      throw new Error('Guild isolation check failed.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const selected = interaction.values[0] as ServerDashboardSection;
    const dashboard = new ServerManagementDashboard(container);
    const payload = dashboard.render(ctx, selected, 0);
    await interaction.update({
      embeds: payload.embeds,
      components: payload.components,
      files: payload.files,
    });
  }
}

async function handleModalSubmitInteraction(
  interaction: ModalSubmitInteraction,
  container: PlatformContainer,
): Promise<void> {
  const id = interaction.customId;

  // 1. Review Approve Modal -> Final Confirmation Step
  if (id.startsWith('tsm:rev:modal:approve:')) {
    const reviewId = id.split(':')[4];
    const review = container.reviews.findReviewGloballyById(reviewId);
    if (!review) throw new Error(`Review \`${reviewId}\` not found.`);

    const ctx = await resolveActorContextForGuild(interaction as never, review.guild_id, container);
    const reason = interaction.fields.getTextInputValue('reason');
    const note = interaction.fields.getTextInputValue('note');

    const res = await container.reviews.initiateWarningApproval(ctx, reviewId, {
      proposedReason: reason,
      proposedNote: note,
      actorDisplayName: interaction.user.username,
    });

    if (res.stage === 'AWAITING_FINAL_CONFIRMATION') {
      const embed = createBrandEmbed({
        title: `${emojis.get('warning')} Final Confirmation Required — \`${reviewId}\``,
        tone: 'danger',
        description:
          `${res.message}\n\n` +
          `**Target Staff:** <@${res.review.staff_user_id}>\n` +
          `**Proposed Level:** ${formatWarningLevelLabel(res.review.suggested_level)}\n` +
          `**Reason:** ${res.review.proposed_reason}\n` +
          (res.review.proposed_note ? `**Note:** ${res.review.proposed_note}` : ''),
      });
      await interaction.reply({
        embeds: [embed],
        components: [container.reviews.buildFinalConfirmationButtons(reviewId)],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = createBrandEmbed({
      title: res.stage === 'AUTO_CANCELLED' ? `${emojis.get('active')} Auto-Cancelled` : `${emojis.get('approval')} Recorded`,
      tone: res.stage === 'AUTO_CANCELLED' ? 'success' : 'warning',
      description: res.message,
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // 2. Warning Appeal Modal
  if (id.startsWith('tsm:wrn:modal:appeal:')) {
    const warningId = id.split(':')[4];
    const warning = container.warnings.findWarningGlobally(warningId);
    if (!warning) throw new Error(`Warning \`${warningId}\` not found.`);
    const appealReason = interaction.fields.getTextInputValue('appeal_reason');

    const appeal = container.warnings.submitAppeal({
      guildId: warning.guild_id,
      warningId,
      staffUserId: interaction.user.id,
      appealReason,
    });

    const embed = createBrandEmbed({
      title: `${emojis.get('tickets')} Appeal Submitted — \`${appeal.appeal_id}\``,
      tone: 'cyan',
      description: `Your appeal for warning \`${warningId}\` has been submitted for management review.`,
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // 3. Global Owner Dashboard Modals
  if (id === 'tsm:god:modal:add_admin') {
    container.permissions.assertGlobalOwner(interaction.user.id, 'MODAL_ADD_BOT_ADMIN');
    const userId = interaction.fields.getTextInputValue('user_id').trim();
    const username = interaction.fields.getTextInputValue('username').trim();
    const saved = container.permissions.addBotAdmin(interaction.user.id, userId, username);
    const embed = createBrandEmbed({
      title: `${emojis.get('security')} Bot Administrator Appointed`,
      tone: 'success',
      description: `Appointed **${saved.username}** (\`${saved.user_id}\`).`,
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'tsm:god:modal:remove_admin') {
    container.permissions.assertGlobalOwner(interaction.user.id, 'MODAL_REMOVE_BOT_ADMIN');
    const userId = interaction.fields.getTextInputValue('user_id').trim();
    const removed = container.permissions.removeBotAdmin(interaction.user.id, userId);
    const embed = createBrandEmbed({
      title: removed ? `${emojis.get('success')} Bot Admin Removed` : `${emojis.get('warning')} Not Found`,
      tone: removed ? 'success' : 'warning',
      description: removed ? `Removed Bot Administrator \`${userId}\`.` : `User \`${userId}\` was not an active Bot Admin.`,
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'tsm:god:modal:toggle_feature') {
    const dashboard = new GlobalOwnerDashboard(container);
    const rawKey = interaction.fields.getTextInputValue('feature_key');
    const res = dashboard.toggleGlobalFeatureByKey(interaction.user.id, rawKey);
    const embed = createBrandEmbed({
      title: `${emojis.get('premium')} Global Feature Updated`,
      tone: 'purple',
      description: `Feature \`${res.key}\` is now **${res.allowed ? 'ALLOWED' : 'GLOBALLY RESTRICTED'}**.`,
    });
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  }

  // 4. Server Management Dashboard Modals
  if (id.startsWith('tsm:srv:modal:')) {
    if (!interaction.guild) throw new Error('Server modal requires guild context.');
    const [, , , guildId, modalAction] = id.split(':');
    if (interaction.guild.id !== guildId) throw new Error('Guild isolation check failed.');

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );

    if (modalAction === 'create_leave') {
      container.permissions.assertGuildCapability(ctx, 'canManageLeave', 'MODAL_CREATE_LEAVE');
      const staffUserId = interaction.fields.getTextInputValue('staff_user_id').trim();
      const startDate = interaction.fields.getTextInputValue('start_date').trim();
      const endDate = interaction.fields.getTextInputValue('end_date').trim();
      const reason = interaction.fields.getTextInputValue('reason').trim();

      const created = container.leave.submitLeaveRequest({
        guildId: ctx.guildId,
        staffUserId,
        requestedById: ctx.userId,
        reason,
        startAt: startDate.includes('T') ? startDate : `${startDate}T00:00:00.000Z`,
        endAt: endDate.includes('T') ? endDate : `${endDate}T23:59:59.999Z`,
        autoApproveById: ctx.userId,
      });

      const embed = createBrandEmbed({
        title: `${emojis.get('success')} Approved Leave Created — \`${created.leave_id}\``,
        tone: 'success',
        description: `Approved leave for <@${created.staff_user_id}> (${created.start_at.slice(0, 10)} → ${created.end_at.slice(0, 10)}).`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (modalAction === 'toggle_feature') {
      container.permissions.assertGuildCapability(ctx, 'canConfigureGuild', 'MODAL_TOGGLE_SERVER_FEATURE');
      const rawKey = interaction.fields.getTextInputValue('feature_key').trim() as FeatureKey;
      if (!ALL_FEATURE_KEYS.includes(rawKey)) {
        throw new Error(`Invalid feature key "${rawKey}".`);
      }
      const current = container.features.getFeatureStatus(ctx.guildId, rawKey);
      const updated = container.features.setGuildFeature(ctx.guildId, ctx.userId, rawKey, !current.guildEnabled);
      const embed = createBrandEmbed({
        title: `${emojis.get('premium')} Local Feature Updated`,
        tone: 'purple',
        description: `Feature \`${updated.key}\` is now **${updated.effectiveEnabled ? 'ENABLED' : 'DISABLED'}**.`,
      });
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
  }
}
