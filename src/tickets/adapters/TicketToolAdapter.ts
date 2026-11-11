import {
  AdapterDiagnosticResult,
  ChannelPermissionCheck,
  ITicketAdapter,
  NormalizedTicketSignal,
  ObservableChannelContext,
  ObservableMessageContext,
} from '../ITicketAdapter';
import { TicketEventType } from '../../types/domain';
import { buildStandardDiagnostics, GenericTicketAdapter } from './GenericTicketAdapter';

const TICKET_TOOL_BOT_IDS = ['557628352828014614'] as const;

function extractFirstMention(text: string): string | null {
  const m = /<@!?(\d{17,20})>/.exec(text);
  return m ? m[1] : null;
}

export class TicketToolAdapter implements ITicketAdapter {
  public readonly id = 'ticket-tool';
  public readonly displayName = 'Ticket Tool Adapter';
  public readonly knownBotIds: readonly string[] = TICKET_TOOL_BOT_IDS;
  public readonly supportedEvents: readonly TicketEventType[] = [
    'CREATED',
    'CLAIMED',
    'ASSIGNED',
    'REASSIGNED',
    'FIRST_RESPONSE',
    'STAFF_RESPONSE',
    'RESOLVED',
    'CLOSED',
    'REOPENED',
  ];
  public readonly limitations: readonly string[] = [
    'Observes public Discord embeds posted by Ticket Tool (557628352828014614), channel renames (ticket-* / closed-*), and permission overwrites.',
    'Note: Message embeds sent by bots ARE visible via Discord Gateway even without MessageContent intent when Ticket Tool posts rich embeds; however, silent dashboard-only actions inside Ticket Tool web panel that emit no Discord channel update or embed cannot be observed without webhook forwarding.',
  ];

  private readonly genericFallback = new GenericTicketAdapter();

  public inspectChannelCreate(channel: ObservableChannelContext, occurredAt: string): NormalizedTicketSignal | null {
    const base = this.genericFallback.inspectChannelCreate(channel, occurredAt);
    if (!base) return null;
    return {
      ...base,
      sourceEventId: `ticket-tool:create:${channel.channelId}`,
    };
  }

  public inspectChannelUpdate(
    before: ObservableChannelContext,
    after: ObservableChannelContext,
    occurredAt: string,
  ): NormalizedTicketSignal[] {
    return this.genericFallback.inspectChannelUpdate(before, after, occurredAt);
  }

  public inspectBotMessage(msg: ObservableMessageContext): NormalizedTicketSignal[] {
    if (!msg.authorIsBot) return [];
    const signals: NormalizedTicketSignal[] = [];

    const combinedText = [
      msg.content ?? '',
      ...(msg.embeds ?? []).flatMap((e) => [
        e.title ?? '',
        e.description ?? '',
        ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`),
      ]),
    ]
      .join('\n')
      .trim();

    if (!combinedText) return signals;
    const lower = combinedText.toLowerCase();
    const mentionedUserId = extractFirstMention(combinedText);

    if (lower.includes('ticket claimed') || lower.includes('claimed this ticket') || lower.includes('claimed by')) {
      signals.push({
        eventType: 'CLAIMED',
        actorUserId: mentionedUserId,
        targetStaffUserId: mentionedUserId,
        sourceEventId: `ticket-tool:claim:${msg.messageId}`,
        occurredAt: msg.occurredAt,
        details: { adapter: this.id, botId: msg.authorId },
      });
    } else if (
      lower.includes('ticket re-opened') ||
      lower.includes('ticket reopened') ||
      lower.includes('re-opened by') ||
      lower.includes('reopened by')
    ) {
      signals.push({
        eventType: 'REOPENED',
        actorUserId: mentionedUserId,
        sourceEventId: `ticket-tool:reopen:${msg.messageId}`,
        occurredAt: msg.occurredAt,
        details: { adapter: this.id, botId: msg.authorId },
      });
    } else if (lower.includes('ticket resolved') || lower.includes('marked as resolved')) {
      signals.push({
        eventType: 'RESOLVED',
        actorUserId: mentionedUserId,
        sourceEventId: `ticket-tool:resolve:${msg.messageId}`,
        occurredAt: msg.occurredAt,
        details: { adapter: this.id, botId: msg.authorId },
      });
    } else if (lower.includes('ticket closed') || lower.includes('closed by')) {
      signals.push({
        eventType: 'CLOSED',
        actorUserId: mentionedUserId,
        sourceEventId: `ticket-tool:close:${msg.messageId}`,
        occurredAt: msg.occurredAt,
        details: { adapter: this.id, botId: msg.authorId },
      });
    } else if (lower.includes('assigned to') || lower.includes('transferred to')) {
      signals.push({
        eventType: 'ASSIGNED',
        targetStaffUserId: mentionedUserId,
        sourceEventId: `ticket-tool:assign:${msg.messageId}`,
        occurredAt: msg.occurredAt,
        details: { adapter: this.id, botId: msg.authorId },
      });
    }

    return signals;
  }

  public diagnose(
    _guildId: string,
    permissionChecks: readonly ChannelPermissionCheck[],
    messageContentEnabled: boolean,
  ): AdapterDiagnosticResult {
    return buildStandardDiagnostics(
      this.id,
      this.displayName,
      this.supportedEvents,
      this.limitations,
      permissionChecks,
      messageContentEnabled,
    );
  }
}
