import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, Client, EmbedBuilder, TextBasedChannel } from 'discord.js';
import { IRelationalDatabase } from '../database/connection';
import { GLOBAL_OWNER_ID, isPermanentGlobalOwner } from '../config/branding';
import { generateEntityId } from '../utils/ids';
import { GuildConfigService } from './GuildConfigService';
import { logger } from '../utils/logger';

export interface OutgoingDiscordPayload {
  embeds: EmbedBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  files?: AttachmentBuilder[];
}

export interface IDiscordDeliveryAdapter {
  sendDirectMessage(userId: string, payload: OutgoingDiscordPayload): Promise<{ delivered: boolean; error?: string }>;
  sendGuildChannelMessage(
    guildId: string,
    channelId: string,
    payload: OutgoingDiscordPayload,
  ): Promise<{ delivered: boolean; error?: string }>;
}

export class DiscordJsDeliveryAdapter implements IDiscordDeliveryAdapter {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  public async sendDirectMessage(
    userId: string,
    payload: OutgoingDiscordPayload,
  ): Promise<{ delivered: boolean; error?: string }> {
    try {
      const user = await this.client.users.fetch(userId);
      await user.send({
        embeds: payload.embeds,
        components: payload.components ?? [],
        files: payload.files ?? [],
      });
      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: message };
    }
  }

  public async sendGuildChannelMessage(
    guildId: string,
    channelId: string,
    payload: OutgoingDiscordPayload,
  ): Promise<{ delivered: boolean; error?: string }> {
    try {
      const guild = await this.client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(channelId);
      if (!channel || !channel.isTextBased() || !('send' in channel)) {
        return { delivered: false, error: `Channel ${channelId} is not a sendable text channel` };
      }
      await (channel as TextBasedChannel & { send: Function }).send({
        embeds: payload.embeds,
        components: payload.components ?? [],
        files: payload.files ?? [],
      });
      return { delivered: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { delivered: false, error: message };
    }
  }
}

export interface NotificationRecord {
  notification_id: string;
  guild_id: string | null;
  recipient_user_id: string;
  is_global_inbox: number;
  notification_type: string;
  dedup_key: string;
  reference_id: string | null;
  title: string;
  summary: string;
  delivery_channel: 'DM' | 'CHANNEL_FALLBACK' | 'GLOBAL_INBOX_ONLY';
  delivered: number;
  error_message: string | null;
  is_read: number;
  created_at: string;
}

export class NotificationService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private deliveryAdapter: IDiscordDeliveryAdapter | null = null;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    deliveryAdapter?: IDiscordDeliveryAdapter,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.deliveryAdapter = deliveryAdapter ?? null;
  }

  public setDeliveryAdapter(adapter: IDiscordDeliveryAdapter): void {
    this.deliveryAdapter = adapter;
  }

  public getDeliveryAdapter(): IDiscordDeliveryAdapter | null {
    return this.deliveryAdapter;
  }

  public async dispatchToRecipient(input: {
    guildId: string | null;
    recipientUserId: string;
    notificationType: string;
    dedupKey: string;
    referenceId?: string | null;
    title: string;
    summary: string;
    payload: OutgoingDiscordPayload;
    fallbackChannelId?: string | null;
  }): Promise<{ skippedDuplicate: boolean; deliveredDm: boolean; usedFallback: boolean; record: NotificationRecord }> {
    const existing = this.db.get<NotificationRecord>(
      'SELECT * FROM notification_history WHERE dedup_key = ?',
      [input.dedupKey],
    );
    if (existing) {
      return {
        skippedDuplicate: true,
        deliveredDm: existing.delivered === 1 && existing.delivery_channel === 'DM',
        usedFallback: existing.delivery_channel === 'CHANNEL_FALLBACK',
        record: existing,
      };
    }

    const isGlobalInbox = isPermanentGlobalOwner(input.recipientUserId) ? 1 : 0;
    const notificationId = generateEntityId('NTF');
    const now = new Date().toISOString();

    let deliveredDm = false;
    let dmError: string | null = null;
    let usedFallback = false;
    let deliveryChannel: 'DM' | 'CHANNEL_FALLBACK' | 'GLOBAL_INBOX_ONLY' = 'GLOBAL_INBOX_ONLY';

    if (this.deliveryAdapter) {
      const dmRes = await this.deliveryAdapter.sendDirectMessage(input.recipientUserId, input.payload);
      if (dmRes.delivered) {
        deliveredDm = true;
        deliveryChannel = 'DM';
      } else {
        dmError = dmRes.error ?? 'DM delivery failed';
        logger.warn(
          { recipientUserId: input.recipientUserId, notificationType: input.notificationType, dmError },
          'Recipient DM delivery failed; attempting fallback retention',
        );

        const fallbackChannelId =
          input.fallbackChannelId ??
          (input.guildId
            ? (this.guildConfig.getGuildConfig(input.guildId)?.fallback_review_channel_id ??
              this.guildConfig.getGuildConfig(input.guildId)?.alert_channel_id ??
              null)
            : null);

        if (input.guildId && fallbackChannelId) {
          const chRes = await this.deliveryAdapter.sendGuildChannelMessage(
            input.guildId,
            fallbackChannelId,
            input.payload,
          );
          if (chRes.delivered) {
            usedFallback = true;
            deliveryChannel = 'CHANNEL_FALLBACK';
          } else {
            dmError = `${dmError}; fallback channel error: ${chRes.error}`;
          }
        }
      }
    }

    const deliveredFlag = deliveredDm || usedFallback ? 1 : 0;

    this.db.run(
      `INSERT INTO notification_history (
        notification_id, guild_id, recipient_user_id, is_global_inbox,
        notification_type, dedup_key, reference_id, title, summary,
        delivery_channel, delivered, error_message, is_read, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        notificationId,
        input.guildId,
        input.recipientUserId,
        isGlobalInbox,
        input.notificationType,
        input.dedupKey,
        input.referenceId ?? null,
        input.title,
        input.summary,
        deliveryChannel,
        deliveredFlag,
        dmError,
        now,
      ],
    );

    const saved = this.db.get<NotificationRecord>(
      'SELECT * FROM notification_history WHERE notification_id = ?',
      [notificationId],
    )!;

    return {
      skippedDuplicate: false,
      deliveredDm,
      usedFallback,
      record: saved,
    };
  }

  /**
   * Dispatches a review/management notification to a deduplicated list of User IDs.
   * Ensures each unique user ID receives at most 1 notification per incident/review.
   */
  public async dispatchDeduplicatedGroup(input: {
    guildId: string;
    recipientUserIds: readonly string[];
    notificationType: string;
    baseDedupKey: string;
    referenceId?: string | null;
    title: string;
    summary: string;
    payload: OutgoingDiscordPayload;
  }): Promise<{
    uniqueRecipientCount: number;
    dmDeliveredCount: number;
    fallbackUsedCount: number;
    globalInboxRetained: boolean;
  }> {
    const uniqueRecipients = Array.from(new Set(input.recipientUserIds));
    let dmDeliveredCount = 0;
    let fallbackUsedCount = 0;
    let globalInboxRetained = false;
    let channelFallbackSentOnce = false;

    const guildCfg = this.guildConfig.getGuildConfig(input.guildId);
    const sharedFallbackChannel = guildCfg?.fallback_review_channel_id ?? guildCfg?.alert_channel_id ?? null;

    for (const userId of uniqueRecipients) {
      const res = await this.dispatchToRecipient({
        guildId: input.guildId,
        recipientUserId: userId,
        notificationType: input.notificationType,
        dedupKey: `${input.baseDedupKey}:user:${userId}`,
        referenceId: input.referenceId,
        title: input.title,
        summary: input.summary,
        payload: input.payload,
        // Avoid spamming the shared server fallback channel multiple times for the same incident
        fallbackChannelId: !channelFallbackSentOnce ? sharedFallbackChannel : null,
      });

      if (res.deliveredDm) dmDeliveredCount += 1;
      if (res.usedFallback) {
        fallbackUsedCount += 1;
        channelFallbackSentOnce = true;
      }
      if (userId === GLOBAL_OWNER_ID) {
        globalInboxRetained = true;
      }
    }

    return {
      uniqueRecipientCount: uniqueRecipients.length,
      dmDeliveredCount,
      fallbackUsedCount,
      globalInboxRetained,
    };
  }

  public listGlobalOwnerInbox(actorUserId: string, onlyUnread = false, limit = 25): NotificationRecord[] {
    if (!isPermanentGlobalOwner(actorUserId)) {
      throw new Error('Forbidden: Global Owner Inbox is strictly restricted to the Permanent Global Owner.');
    }
    if (onlyUnread) {
      return this.db.all<NotificationRecord>(
        `SELECT * FROM notification_history
         WHERE recipient_user_id = ? AND is_global_inbox = 1 AND is_read = 0
         ORDER BY created_at DESC LIMIT ?`,
        [GLOBAL_OWNER_ID, limit],
      );
    }
    return this.db.all<NotificationRecord>(
      `SELECT * FROM notification_history
       WHERE recipient_user_id = ? AND is_global_inbox = 1
       ORDER BY created_at DESC LIMIT ?`,
      [GLOBAL_OWNER_ID, limit],
    );
  }
}
