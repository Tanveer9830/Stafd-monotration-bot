import {
  AuditLogEvent,
  Client,
  Events,
  GuildChannel,
  Message,
  OverwriteType,
  ThreadChannel,
} from 'discord.js';
import { registerDiscordSlashCommands } from '../commands';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { DiscordJsDeliveryAdapter } from '../services/NotificationService';
import { ObservableChannelContext } from '../tickets/ITicketAdapter';
import { collectLiveGuildTelemetry } from '../utils/discordContext';
import { logger } from '../utils/logger';
import { routeDiscordInteraction } from './interactionRouter';

function extractOverwriteStaffIds(channel: GuildChannel, container: PlatformContainer): string[] {
  if (!('permissionOverwrites' in channel) || !channel.permissionOverwrites) return [];
  const staffIds: string[] = [];
  for (const [, ow] of channel.permissionOverwrites.cache) {
    if (
      ow.type === OverwriteType.Member &&
      container.roster.isActiveStaffMember(channel.guild.id, ow.id)
    ) {
      staffIds.push(ow.id);
    }
  }
  return staffIds;
}

export function bindGatewayEvents(client: Client, container: PlatformContainer): void {
  container.notifications.setDeliveryAdapter(new DiscordJsDeliveryAdapter(client));

  container.scheduler.setLiveContextProvider(async (guildId: string) => {
    const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
    if (!guild) return {};
    return collectLiveGuildTelemetry(guild, container);
  });

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info(
      { botTag: readyClient.user.tag, guildCount: readyClient.guilds.cache.size },
      'TANVEER STAFF MONITOR connected to Discord Gateway',
    );

    // Sync verified custom emoji IDs from application/guilds
    const verifiedIds = new Set<string>(readyClient.emojis.cache.keys());
    try {
      const appEmojis = await readyClient.application.emojis.fetch();
      for (const [id] of appEmojis) verifiedIds.add(id);
    } catch {
      // Application emoji fetch optional depending on Discord API scopes
    }
    emojis.setVerifiedEmojiIds(verifiedIds.size > 0 ? verifiedIds : null);

    // Register & sync all connected guilds
    for (const [, guild] of readyClient.guilds.cache) {
      container.guildConfig.ensureGuildRegistered(guild.id, guild.name, guild.ownerId);
      const telemetry = await collectLiveGuildTelemetry(guild, container);
      container.roster.syncGuildRoster(guild.id, telemetry.liveMembers);
    }

    if (container.config.autoRegisterCommandsOnStartup && container.config.discordClientId) {
      try {
        const reg = await registerDiscordSlashCommands({
          token: container.config.discordToken,
          clientId: container.config.discordClientId,
          devGuildId: container.config.discordDevGuildId,
        });
        logger.info(reg, 'Registered Discord slash commands on startup');
      } catch (err) {
        logger.error({ err }, 'Automatic slash command registration failed on startup');
      }
    }

    container.scheduler.start(container.config.schedulerTickSeconds);
  });

  client.on(Events.GuildCreate, async (guild) => {
    container.guildConfig.ensureGuildRegistered(guild.id, guild.name, guild.ownerId);
    const telemetry = await collectLiveGuildTelemetry(guild, container);
    container.roster.syncGuildRoster(guild.id, telemetry.liveMembers);
    container.scheduler.initializeSchedules();
  });

  client.on(Events.GuildUpdate, (_oldGuild, newGuild) => {
    // Automatically reflects server ownership transfer!
    container.guildConfig.ensureGuildRegistered(newGuild.id, newGuild.name, newGuild.ownerId);
  });

  client.on(Events.GuildMemberUpdate, async (_oldMember, newMember) => {
    const telemetry = await collectLiveGuildTelemetry(newMember.guild, container);
    container.roster.syncGuildRoster(newMember.guild.id, telemetry.liveMembers);
  });

  client.on(Events.GuildMemberRemove, (member) => {
    container.roster.handleMemberLeave(member.guild.id, member.id);
  });

  client.on(Events.ChannelCreate, (channel) => {
    if (!channel.guild) return;
    container.guildConfig.ensureGuildRegistered(channel.guild.id, channel.guild.name, channel.guild.ownerId);
    const cfg = container.tickets.matchMonitoredChannel(channel.guild.id, channel.id, channel.parentId);
    if (!cfg) return;

    const { adapter } = container.tickets.adapterRegistry.get(cfg.adapter_type);
    const ctx: ObservableChannelContext = {
      guildId: channel.guild.id,
      channelId: channel.id,
      channelName: channel.name,
      parentCategoryId: channel.parentId,
      isThread: false,
      topic: 'topic' in channel ? (channel.topic ?? null) : null,
      overwritesStaffUserIds: extractOverwriteStaffIds(channel, container),
    };
    const sig = adapter.inspectChannelCreate(ctx, new Date().toISOString());
    if (sig) {
      container.tickets.applyAdapterSignals(channel.guild.id, ctx, adapter.id, [sig]);
    }
  });

  client.on(Events.ChannelUpdate, (oldCh, newCh) => {
    if (!('guild' in newCh) || !newCh.guild || !('guild' in oldCh)) return;
    const cfg = container.tickets.matchMonitoredChannel(newCh.guild.id, newCh.id, newCh.parentId);
    if (!cfg) return;

    const { adapter } = container.tickets.adapterRegistry.get(cfg.adapter_type);
    const beforeCtx: ObservableChannelContext = {
      guildId: newCh.guild.id,
      channelId: oldCh.id,
      channelName: 'name' in oldCh ? oldCh.name : newCh.id,
      parentCategoryId: 'parentId' in oldCh ? oldCh.parentId : null,
      overwritesStaffUserIds: extractOverwriteStaffIds(oldCh as GuildChannel, container),
    };
    const afterCtx: ObservableChannelContext = {
      guildId: newCh.guild.id,
      channelId: newCh.id,
      channelName: newCh.name,
      parentCategoryId: newCh.parentId,
      overwritesStaffUserIds: extractOverwriteStaffIds(newCh as GuildChannel, container),
    };
    const signals = adapter.inspectChannelUpdate(beforeCtx, afterCtx, new Date().toISOString());
    container.tickets.applyAdapterSignals(newCh.guild.id, afterCtx, adapter.id, signals);
  });

  client.on(Events.ThreadCreate, (thread: ThreadChannel) => {
    const parentCatId = thread.parent?.parentId ?? null;
    const cfg = container.tickets.matchMonitoredChannel(thread.guild.id, thread.id, thread.parentId, parentCatId);
    if (!cfg) return;

    const { adapter } = container.tickets.adapterRegistry.get(cfg.adapter_type);
    const ctx: ObservableChannelContext = {
      guildId: thread.guild.id,
      channelId: thread.id,
      channelName: thread.name,
      parentCategoryId: thread.parentId,
      isThread: true,
      archived: Boolean(thread.archived),
    };
    const sig = adapter.inspectChannelCreate(ctx, new Date().toISOString());
    if (sig) {
      container.tickets.applyAdapterSignals(thread.guild.id, ctx, adapter.id, [sig]);
    }
  });

  client.on(Events.ThreadUpdate, (oldThread: ThreadChannel, newThread: ThreadChannel) => {
    const parentCatId = newThread.parent?.parentId ?? null;
    const cfg = container.tickets.matchMonitoredChannel(
      newThread.guild.id,
      newThread.id,
      newThread.parentId,
      parentCatId,
    );
    if (!cfg) return;

    const { adapter } = container.tickets.adapterRegistry.get(cfg.adapter_type);
    const beforeCtx: ObservableChannelContext = {
      guildId: newThread.guild.id,
      channelId: oldThread.id,
      channelName: oldThread.name,
      parentCategoryId: oldThread.parentId,
      isThread: true,
      archived: Boolean(oldThread.archived),
    };
    const afterCtx: ObservableChannelContext = {
      guildId: newThread.guild.id,
      channelId: newThread.id,
      channelName: newThread.name,
      parentCategoryId: newThread.parentId,
      isThread: true,
      archived: Boolean(newThread.archived),
    };
    const signals = adapter.inspectChannelUpdate(beforeCtx, afterCtx, new Date().toISOString());
    container.tickets.applyAdapterSignals(newThread.guild.id, afterCtx, adapter.id, signals);
  });

  client.on(Events.MessageCreate, (message: Message) => {
    if (!message.guild) return;
    container.guildConfig.ensureGuildRegistered(message.guild.id, message.guild.name, message.guild.ownerId);

    const ch = message.channel;
    const isThread = ch.isThread();
    const parentId = 'parentId' in ch ? ch.parentId : null;
    const grandParentId = isThread && ch.parent ? ch.parent.parentId : null;
    const channelName = 'name' in ch && ch.name ? ch.name : message.channelId;

    const matchedTicketCfg = container.tickets.matchMonitoredChannel(
      message.guild.id,
      message.channelId,
      parentId,
      grandParentId,
    );

    if (message.author.bot) {
      if (matchedTicketCfg && !message.webhookId) {
        container.tickets.handleBotAdapterMessage({
          guildId: message.guild.id,
          channelId: message.channelId,
          channelName,
          parentCategoryId: parentId,
          isThread,
          messageId: message.id,
          authorId: message.author.id,
          authorIsBot: true,
          webhookId: message.webhookId,
          content: message.content,
          contentAvailable: container.config.enableMessageContentIntent,
          attachmentCount: message.attachments.size,
          embeds: message.embeds.map((e) => ({
            title: e.title,
            description: e.description,
            footerText: e.footer?.text ?? null,
            fields: e.fields.map((f) => ({ name: f.name, value: f.value })),
          })),
          occurredAt: message.createdAt.toISOString(),
        });
      }
      return;
    }

    if (matchedTicketCfg && container.features.isEnabled(message.guild.id, 'ticket_monitoring')) {
      let ticket = container.tickets.getOpenTicketByChannel(message.guild.id, message.channelId);
      if (!ticket) {
        ticket = container.tickets.createTicket({
          guildId: message.guild.id,
          channelId: message.channelId,
          channelName,
          parentCategoryId: parentId,
          isThread,
          openerUserId: container.roster.isActiveStaffMember(message.guild.id, message.author.id)
            ? null
            : message.author.id,
          adapterSource: matchedTicketCfg.adapter_type,
          openedAt: message.createdAt.toISOString(),
        }).ticket;
      }

      if (ticket && container.roster.isActiveStaffMember(message.guild.id, message.author.id)) {
        container.tickets.recordTicketStaffMessage({
          guildId: message.guild.id,
          ticketId: ticket.ticket_id,
          staffUserId: message.author.id,
          channelId: message.channelId,
          messageId: message.id,
          content: message.content,
          contentAvailable: container.config.enableMessageContentIntent,
          attachmentCount: message.attachments.size,
          isBot: message.author.bot,
          isWebhook: Boolean(message.webhookId),
          occurredAt: message.createdAt.toISOString(),
        });
        return;
      }
    }

    // Non-ticket configured support work channel check
    container.classifier.evaluateMessageActivity({
      guildId: message.guild.id,
      userId: message.author.id,
      channelId: message.channelId,
      messageId: message.id,
      content: message.content,
      contentAvailable: container.config.enableMessageContentIntent,
      attachmentCount: message.attachments.size,
      embedCount: message.embeds.length,
      isBot: message.author.bot,
      isWebhook: Boolean(message.webhookId),
      isTicketChannel: false,
      occurredAt: message.createdAt.toISOString(),
    });
  });

  // Observe real Discord moderation actions from Guild Audit Logs
  client.on(Events.GuildAuditLogEntryCreate, (entry, guild) => {
    if (!entry.executorId) return;
    const modActions = new Set<AuditLogEvent>([
      AuditLogEvent.MemberKick,
      AuditLogEvent.MemberBanAdd,
      AuditLogEvent.MemberUpdate,
      AuditLogEvent.MessageDelete,
    ]);
    if (modActions.has(entry.action)) {
      container.classifier.recordExplicitStaffWork({
        guildId: guild.id,
        userId: entry.executorId,
        eventType: 'MODERATION_ACTION',
        reason: `Approved Discord moderation action (${AuditLogEvent[entry.action]})`,
        metadata: { auditAction: entry.action, targetId: entry.targetId },
      });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    await routeDiscordInteraction(interaction, container);
  });
}
