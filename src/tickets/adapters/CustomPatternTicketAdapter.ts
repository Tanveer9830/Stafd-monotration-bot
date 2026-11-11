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

export class CustomPatternTicketAdapter implements ITicketAdapter {
  public readonly id = 'custom';
  public readonly displayName = 'Custom Ticket Bot Pattern Adapter';
  public readonly knownBotIds: readonly string[] = [];
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
    'Matches configurable channel naming patterns (e.g. ticket-*, support-*) and public embed lifecycle keywords.',
    'External proprietary databases or non-Discord webhooks are not queried directly; only genuine Discord channel/embed events are observed.',
  ];

  private readonly genericFallback = new GenericTicketAdapter();

  public inspectChannelCreate(channel: ObservableChannelContext, occurredAt: string): NormalizedTicketSignal | null {
    const base = this.genericFallback.inspectChannelCreate(channel, occurredAt);
    return base ? { ...base, sourceEventId: `custom:create:${channel.channelId}` } : null;
  }

  public inspectChannelUpdate(
    before: ObservableChannelContext,
    after: ObservableChannelContext,
    occurredAt: string,
  ): NormalizedTicketSignal[] {
    return this.genericFallback.inspectChannelUpdate(before, after, occurredAt);
  }

  public inspectBotMessage(_msg: ObservableMessageContext): NormalizedTicketSignal[] {
    return [];
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
