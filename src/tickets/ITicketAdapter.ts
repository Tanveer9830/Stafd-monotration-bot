import { TicketEventType } from '../types/domain';

export interface ObservableEmbedSummary {
  title?: string | null;
  description?: string | null;
  footerText?: string | null;
  fields?: Array<{ name: string; value: string }>;
}

export interface ObservableChannelContext {
  guildId: string;
  channelId: string;
  channelName: string;
  parentCategoryId?: string | null;
  isThread?: boolean;
  archived?: boolean;
  topic?: string | null;
  overwritesStaffUserIds?: string[];
}

export interface ObservableMessageContext {
  guildId: string;
  channelId: string;
  channelName: string;
  parentCategoryId?: string | null;
  isThread?: boolean;
  messageId: string;
  authorId: string;
  authorIsBot: boolean;
  webhookId?: string | null;
  content?: string | null;
  contentAvailable?: boolean;
  attachmentCount?: number;
  embeds?: ObservableEmbedSummary[];
  occurredAt: string;
}

export interface NormalizedTicketSignal {
  eventType: TicketEventType;
  actorUserId?: string | null;
  targetStaffUserId?: string | null;
  openerUserId?: string | null;
  externalTicketRef?: string | null;
  sourceEventId: string;
  occurredAt: string;
  details?: Record<string, unknown>;
}

export interface ChannelPermissionCheck {
  channelId: string;
  channelName: string;
  targetType: 'CHANNEL' | 'CATEGORY' | 'THREAD_PARENT';
  exists: boolean;
  canViewChannel: boolean;
  canReadHistory: boolean;
  canSendMessages: boolean;
}

export interface AdapterDiagnosticResult {
  adapterId: string;
  adapterName: string;
  healthy: boolean;
  coverageLevel: 'FULL' | 'PARTIAL' | 'UNAVAILABLE';
  supportedEvents: TicketEventType[];
  observableLimitations: string[];
  missingPermissions: string[];
  channelIssues: string[];
}

export interface ITicketAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly knownBotIds: readonly string[];
  readonly supportedEvents: readonly TicketEventType[];
  readonly limitations: readonly string[];

  inspectChannelCreate(channel: ObservableChannelContext, occurredAt: string): NormalizedTicketSignal | null;

  inspectChannelUpdate(
    before: ObservableChannelContext,
    after: ObservableChannelContext,
    occurredAt: string,
  ): NormalizedTicketSignal[];

  inspectBotMessage(msg: ObservableMessageContext): NormalizedTicketSignal[];

  diagnose(
    guildId: string,
    permissionChecks: readonly ChannelPermissionCheck[],
    messageContentEnabled: boolean,
  ): AdapterDiagnosticResult;
}
