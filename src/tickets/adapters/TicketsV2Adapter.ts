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

const TICKETS_V2_BOT_IDS = ['508391840525975553'] as const;

export class TicketsV2Adapter implements ITicketAdapter {
  public readonly id = 'tickets-v2';
  public readonly displayName = 'Tickets v2 Adapter';
  public readonly knownBotIds: readonly string[] = TICKETS_V2_BOT_IDS;
  public readonly supportedEvents: readonly TicketEventType[] = [
    'CREATED',
    'CLAIMED',
    'ASSIGNED',
    'FIRST_RESPONSE',
    'STAFF_RESPONSE',
    'CLOSED',
    'REOPENED',
  ];
  public readonly limitations: readonly string[] = [
    'Observes Tickets v2 (508391840525975553) thread/channel creation, claim announcements, and thread archive/closure.',
    'Note: Private threads created by Tickets v2 require the bot to hold ManageThreads or ViewChannel + ReadMessageHistory in the parent channel to inspect messages inside private threads.',
  ];

  private readonly genericFallback = new GenericTicketAdapter();

  public inspectChannelCreate(channel: ObservableChannelContext, occurredAt: string): NormalizedTicketSignal | null {
    const base = this.genericFallback.inspectChannelCreate(channel, occurredAt);
    return base ? { ...base, sourceEventId: `tickets-v2:create:${channel.channelId}` } : null;
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
    const text = [
      msg.content ?? '',
      ...(msg.embeds ?? []).flatMap((e) => [e.title ?? '', e.description ?? '']),
    ]
      .join(' ')
      .toLowerCase();

    const mentionMatch = /<@!?(\d{17,20})>/.exec(
      [msg.content ?? '', ...(msg.embeds ?? []).map((e) => e.description ?? '')].join(' '),
    );
    const mentionedId = mentionMatch ? mentionMatch[1] : null;

    const out: NormalizedTicketSignal[] = [];
    if (text.includes('claimed') && mentionedId) {
      out.push({
        eventType: 'CLAIMED',
        actorUserId: mentionedId,
        targetStaffUserId: mentionedId,
        sourceEventId: `tickets-v2:claim:${msg.messageId}`,
        occurredAt: msg.occurredAt,
      });
    } else if (text.includes('ticket closed') || text.includes('closed this ticket')) {
      out.push({
        eventType: 'CLOSED',
        actorUserId: mentionedId,
        sourceEventId: `tickets-v2:close:${msg.messageId}`,
        occurredAt: msg.occurredAt,
      });
    }
    return out;
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
