import crypto from 'node:crypto';
import { IRelationalDatabase } from '../database/connection';
import { ActivityEventType } from '../types/domain';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { RosterService } from './RosterService';

export interface MessageObservationInput {
  guildId: string;
  userId: string;
  channelId: string;
  messageId: string;
  content?: string | null;
  contentAvailable?: boolean;
  attachmentCount?: number;
  embedCount?: number;
  isBot?: boolean;
  isWebhook?: boolean;
  isTicketChannel?: boolean;
  ticketId?: string | null;
  isFirstTicketResponse?: boolean;
  isSupportChannel?: boolean;
  isReplyToUser?: boolean;
  occurredAt?: string;
}

export interface ActivityClassificationResult {
  recorded: boolean;
  isQualifying: boolean;
  eventType: ActivityEventType;
  reason: string;
}

export type QualifyingWorkCallback = (
  guildId: string,
  userId: string,
  occurredAt: string,
  eventType: ActivityEventType,
) => void;

const LOW_VALUE_FILLERS = new Set([
  'ok',
  'okay',
  'k',
  'kk',
  'hi',
  'hey',
  'hello',
  'yo',
  'sup',
  'lol',
  'lmao',
  'bruh',
  'bump',
  'up',
  'test',
  'testing',
  'ty',
  'thx',
  'np',
  'yes',
  'no',
  'idk',
  'hmm',
  'wait',
]);

export class ActivityClassifierService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly roster: RosterService;
  private readonly recentFingerprints = new Map<string, { hash: string; timestampMs: number }[]>();
  private readonly qualifyingListeners: QualifyingWorkCallback[] = [];

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    roster: RosterService,
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.roster = roster;
  }

  public onQualifyingWork(listener: QualifyingWorkCallback): void {
    this.qualifyingListeners.push(listener);
  }

  private notifyQualifyingListeners(
    guildId: string,
    userId: string,
    occurredAt: string,
    eventType: ActivityEventType,
  ): void {
    for (const listener of this.qualifyingListeners) {
      listener(guildId, userId, occurredAt, eventType);
    }
  }

  private checkDuplicateOrBurstSpam(
    guildId: string,
    userId: string,
    fingerprint: string,
    occurredMs: number,
  ): { isSpam: boolean; reason?: string } {
    const key = `${guildId}:${userId}`;
    const cutoff = occurredMs - 120_000; // 2 minute anti-spam window
    const recent = (this.recentFingerprints.get(key) ?? []).filter((r) => r.timestampMs >= cutoff);

    if (fingerprint !== 'NO_CONTENT_META') {
      const identicalCount = recent.filter((r) => r.hash === fingerprint).length;
      if (identicalCount >= 1) {
        this.recentFingerprints.set(key, recent);
        return { isSpam: true, reason: 'Repeated identical message within 2-minute anti-spam window' };
      }
    }

    // Burst rate check: >4 messages within 10 seconds
    const tenSecCutoff = occurredMs - 10_000;
    const burstCount = recent.filter((r) => r.timestampMs >= tenSecCutoff).length;
    if (burstCount >= 4) {
      this.recentFingerprints.set(key, recent);
      return { isSpam: true, reason: 'Rapid message burst spam (>4 messages in 10s)' };
    }

    recent.push({ hash: fingerprint, timestampMs: occurredMs });
    this.recentFingerprints.set(key, recent);
    return { isSpam: false };
  }

  public evaluateMessageActivity(input: MessageObservationInput): ActivityClassificationResult {
    // 1. Never count bot or webhook messages
    if (input.isBot) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Ignored bot account message',
      };
    }
    if (input.isWebhook) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Ignored webhook message',
      };
    }

    if (!this.features.isEnabled(input.guildId, 'activity_monitoring')) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Activity monitoring feature is disabled for this server',
      };
    }

    // Only track configured staff members
    if (!this.roster.isActiveStaffMember(input.guildId, input.userId)) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Author is not a currently monitored staff member',
      };
    }

    const guildCfg = this.guildConfig.getGuildConfig(input.guildId);
    let configuredSupportChannels: string[] = [];
    try {
      configuredSupportChannels = guildCfg ? (JSON.parse(guildCfg.support_work_channel_ids_json) as string[]) : [];
    } catch {
      configuredSupportChannels = [];
    }

    const isSupportWorkChannel =
      Boolean(input.isSupportChannel) || configuredSupportChannels.includes(input.channelId);

    // Must occur inside a monitored ticket channel/thread OR configured support work channel
    if (!input.isTicketChannel && !isSupportWorkChannel) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Unrelated conversation outside configured ticket or support channels',
      };
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const occurredMs = Date.parse(occurredAt) || Date.now();
    const attachments = input.attachmentCount ?? 0;
    const embeds = input.embedCount ?? 0;
    const contentAvailable = input.contentAvailable ?? input.content !== undefined;
    const rawContent = (input.content ?? '').trim();

    let fingerprint = 'NO_CONTENT_META';
    let wordCount = 0;
    let uniqueWordCount = 0;

    if (contentAvailable && rawContent.length > 0) {
      const normalized = rawContent.toLowerCase().replace(/\s+/g, ' ');
      fingerprint = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);

      const cleanAlpha = normalized.replace(/[^a-z0-9\s]/gi, ' ').trim();
      const words = cleanAlpha.length > 0 ? cleanAlpha.split(/\s+/).filter(Boolean) : [];
      wordCount = words.length;
      uniqueWordCount = new Set(words).size;

      // Reject pure punctuation/emojis or ultra-short filler when no attachment is attached
      if (attachments === 0) {
        if (rawContent.length < 8 || wordCount < 2) {
          return this.persistActivityEvent({
            guildId: input.guildId,
            userId: input.userId,
            eventType: 'NON_QUALIFYING_IGNORED',
            isQualifying: false,
            reason: 'Message too brief or lacks substantive content (<2 words / <8 chars)',
            channelId: input.channelId,
            messageId: input.messageId,
            ticketId: input.ticketId ?? null,
            metadata: { length: rawContent.length, wordCount, attachments },
            occurredAt,
          });
        }

        if (wordCount <= 2 && words.every((w) => LOW_VALUE_FILLERS.has(w))) {
          return this.persistActivityEvent({
            guildId: input.guildId,
            userId: input.userId,
            eventType: 'NON_QUALIFYING_IGNORED',
            isQualifying: false,
            reason: 'Filler acknowledgement without substantive support content',
            channelId: input.channelId,
            messageId: input.messageId,
            ticketId: input.ticketId ?? null,
            metadata: { length: rawContent.length, wordCount },
            occurredAt,
          });
        }

        // Reject single repeated character spam like "aaaaaaaaaaaa"
        if (/^(.)\1{6,}$/.test(normalized.replace(/\s/g, ''))) {
          return this.persistActivityEvent({
            guildId: input.guildId,
            userId: input.userId,
            eventType: 'NON_QUALIFYING_IGNORED',
            isQualifying: false,
            reason: 'Repeated character spam pattern rejected',
            channelId: input.channelId,
            messageId: input.messageId,
            ticketId: input.ticketId ?? null,
            metadata: { length: rawContent.length },
            occurredAt,
          });
        }
      }
    } else if (contentAvailable && rawContent.length === 0 && attachments === 0 && embeds === 0) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Empty message without attachments',
      };
    }

    const spamCheck = this.checkDuplicateOrBurstSpam(input.guildId, input.userId, fingerprint, occurredMs);
    if (spamCheck.isSpam) {
      return this.persistActivityEvent({
        guildId: input.guildId,
        userId: input.userId,
        eventType: 'NON_QUALIFYING_IGNORED',
        isQualifying: false,
        reason: spamCheck.reason ?? 'Anti-spam filter rejected message',
        channelId: input.channelId,
        messageId: input.messageId,
        ticketId: input.ticketId ?? null,
        metadata: { fingerprint, length: rawContent.length },
        occurredAt,
      });
    }

    const eventType: ActivityEventType = input.isTicketChannel
      ? input.isFirstTicketResponse
        ? 'TICKET_FIRST_RESPONSE'
        : 'TICKET_RESPONSE'
      : 'SUPPORT_WORK';

    const reason = input.isTicketChannel
      ? contentAvailable
        ? `Qualifying ticket response (${wordCount} words, ${attachments} attachments)`
        : 'Qualifying ticket response observed via channel event metadata'
      : `Qualifying support work in configured support channel (${wordCount} words)`;

    return this.persistActivityEvent({
      guildId: input.guildId,
      userId: input.userId,
      eventType,
      isQualifying: true,
      reason,
      channelId: input.channelId,
      messageId: input.messageId,
      ticketId: input.ticketId ?? null,
      metadata: {
        contentLength: rawContent.length,
        wordCount,
        uniqueWordCount,
        attachments,
        isReplyToUser: Boolean(input.isReplyToUser),
        contentInspected: contentAvailable,
      },
      occurredAt,
    });
  }

  public recordExplicitStaffWork(input: {
    guildId: string;
    userId: string;
    eventType: 'TICKET_RESOLUTION' | 'MODERATION_ACTION' | 'MANAGEMENT_WORK' | 'CONFIGURED_WORK';
    reason: string;
    channelId?: string | null;
    ticketId?: string | null;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
  }): ActivityClassificationResult {
    if (!this.features.isEnabled(input.guildId, 'activity_monitoring')) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Activity monitoring feature disabled',
      };
    }

    if (!this.roster.isActiveStaffMember(input.guildId, input.userId)) {
      return {
        recorded: false,
        isQualifying: false,
        eventType: 'NON_QUALIFYING_IGNORED',
        reason: 'Actor is not a currently monitored staff member',
      };
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    return this.persistActivityEvent({
      guildId: input.guildId,
      userId: input.userId,
      eventType: input.eventType,
      isQualifying: true,
      reason: input.reason,
      channelId: input.channelId ?? null,
      messageId: null,
      ticketId: input.ticketId ?? null,
      metadata: input.metadata ?? {},
      occurredAt,
    });
  }

  private persistActivityEvent(params: {
    guildId: string;
    userId: string;
    eventType: ActivityEventType;
    isQualifying: boolean;
    reason: string;
    channelId: string | null;
    messageId: string | null;
    ticketId: string | null;
    metadata: Record<string, unknown>;
    occurredAt: string;
  }): ActivityClassificationResult {
    const isTicketRelated =
      params.eventType === 'TICKET_RESPONSE' ||
      params.eventType === 'TICKET_FIRST_RESPONSE' ||
      params.eventType === 'TICKET_RESOLUTION';

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO activity_events (
          guild_id, user_id, event_type, is_qualifying, classification_reason,
          channel_id, message_id, ticket_id, metadata_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          params.guildId,
          params.userId,
          params.eventType,
          params.isQualifying ? 1 : 0,
          params.reason,
          params.channelId,
          params.messageId,
          params.ticketId,
          JSON.stringify(params.metadata),
          params.occurredAt,
        ],
      );

      if (params.isQualifying) {
        this.db.run(
          `UPDATE staff_profiles SET
            last_qualifying_work_at = CASE
              WHEN last_qualifying_work_at IS NULL OR last_qualifying_work_at < ? THEN ?
              ELSE last_qualifying_work_at
            END,
            last_ticket_activity_at = CASE
              WHEN ? = 1 AND (last_ticket_activity_at IS NULL OR last_ticket_activity_at < ?) THEN ?
              ELSE last_ticket_activity_at
            END,
            last_staff_work_at = CASE
              WHEN ? = 0 AND (last_staff_work_at IS NULL OR last_staff_work_at < ?) THEN ?
              ELSE last_staff_work_at
            END,
            monitoring_status = CASE
              WHEN monitoring_status IN ('AT_RISK', 'INACTIVE', 'NEW_STAFF', 'UNKNOWN', 'INSUFFICIENT_WORKLOAD')
              THEN 'ACTIVE'
              ELSE monitoring_status
            END,
            updated_at = ?
          WHERE guild_id = ? AND user_id = ?`,
          [
            params.occurredAt,
            params.occurredAt,
            isTicketRelated ? 1 : 0,
            params.occurredAt,
            params.occurredAt,
            isTicketRelated ? 1 : 0,
            params.occurredAt,
            params.occurredAt,
            params.occurredAt,
            params.guildId,
            params.userId,
          ],
        );
      }
    });

    if (params.isQualifying) {
      this.notifyQualifyingListeners(params.guildId, params.userId, params.occurredAt, params.eventType);
    }

    return {
      recorded: true,
      isQualifying: params.isQualifying,
      eventType: params.eventType,
      reason: params.reason,
    };
  }

  public listStaffActivityEvents(
    guildId: string,
    userId: string,
    options?: { onlyQualifying?: boolean; limit?: number; offset?: number },
  ): Array<{
    id: number;
    event_type: ActivityEventType;
    is_qualifying: number;
    classification_reason: string;
    channel_id: string | null;
    ticket_id: string | null;
    metadata_json: string;
    occurred_at: string;
  }> {
    const clauses = ['guild_id = ?', 'user_id = ?'];
    const params: unknown[] = [guildId, userId];
    if (options?.onlyQualifying !== false) {
      clauses.push('is_qualifying = 1');
    }
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);
    params.push(limit, offset);

    return this.db.all(
      `SELECT id, event_type, is_qualifying, classification_reason, channel_id, ticket_id, metadata_json, occurred_at
       FROM activity_events
       WHERE ${clauses.join(' AND ')}
       ORDER BY occurred_at DESC LIMIT ? OFFSET ?`,
      params,
    );
  }
}
