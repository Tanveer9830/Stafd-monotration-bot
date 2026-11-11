import {
  AdapterDiagnosticResult,
  ChannelPermissionCheck,
  ITicketAdapter,
  NormalizedTicketSignal,
  ObservableChannelContext,
  ObservableMessageContext,
} from '../ITicketAdapter';
import { TicketEventType } from '../../types/domain';

function extractUserMention(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = /<@!?(\d{17,20})>/.exec(text);
  return match ? match[1] : null;
}

export class GenericTicketAdapter implements ITicketAdapter {
  public readonly id = 'generic';
  public readonly displayName = 'Generic Discord Ticket Engine';
  public readonly knownBotIds: readonly string[] = [];
  public readonly supportedEvents: readonly TicketEventType[] = [
    'CREATED',
    'CLAIMED',
    'ASSIGNED',
    'REASSIGNED',
    'OWNERSHIP_CHANGED',
    'FIRST_RESPONSE',
    'STAFF_RESPONSE',
    'RESOLVED',
    'CLOSED',
    'REOPENED',
  ];
  public readonly limitations: readonly string[] = [
    'Observes real Discord channel/thread creation, renames (e.g. closed-*, resolved-*), thread archive state changes, permission overwrites, and visible ticket embeds.',
    'Ephemeral interactions sent privately between another bot and a user cannot be observed by any third-party Discord bot.',
  ];

  public inspectChannelCreate(channel: ObservableChannelContext, occurredAt: string): NormalizedTicketSignal | null {
    const openerFromTopic = extractUserMention(channel.topic);
    return {
      eventType: 'CREATED',
      openerUserId: openerFromTopic,
      externalTicketRef: channel.channelName,
      sourceEventId: `generic:create:${channel.channelId}`,
      occurredAt,
      details: { channelName: channel.channelName, isThread: Boolean(channel.isThread) },
    };
  }

  public inspectChannelUpdate(
    before: ObservableChannelContext,
    after: ObservableChannelContext,
    occurredAt: string,
  ): NormalizedTicketSignal[] {
    const signals: NormalizedTicketSignal[] = [];

    const prevName = before.channelName.toLowerCase();
    const nextName = after.channelName.toLowerCase();

    // Detect rename-based resolution / closure / reopen
    if (!prevName.startsWith('resolved-') && nextName.startsWith('resolved-')) {
      signals.push({
        eventType: 'RESOLVED',
        sourceEventId: `generic:rename-resolved:${after.channelId}:${occurredAt}`,
        occurredAt,
        details: { from: before.channelName, to: after.channelName },
      });
    } else if (!prevName.startsWith('closed-') && nextName.startsWith('closed-')) {
      signals.push({
        eventType: 'CLOSED',
        sourceEventId: `generic:rename-closed:${after.channelId}:${occurredAt}`,
        occurredAt,
        details: { from: before.channelName, to: after.channelName },
      });
    } else if (
      (prevName.startsWith('closed-') || prevName.startsWith('resolved-')) &&
      !nextName.startsWith('closed-') &&
      !nextName.startsWith('resolved-')
    ) {
      signals.push({
        eventType: 'REOPENED',
        sourceEventId: `generic:rename-reopen:${after.channelId}:${occurredAt}`,
        occurredAt,
        details: { from: before.channelName, to: after.channelName },
      });
    }

    // Thread archive / unarchive transitions
    if (!before.archived && after.archived) {
      signals.push({
        eventType: 'CLOSED',
        sourceEventId: `generic:thread-archive:${after.channelId}:${occurredAt}`,
        occurredAt,
        details: { reason: 'Thread archived' },
      });
    } else if (before.archived && !after.archived) {
      signals.push({
        eventType: 'REOPENED',
        sourceEventId: `generic:thread-unarchive:${after.channelId}:${occurredAt}`,
        occurredAt,
        details: { reason: 'Thread unarchived' },
      });
    }

    // Permission overwrite staff assignment / reassignment detection
    const beforeStaff = new Set(before.overwritesStaffUserIds ?? []);
    const afterStaff = new Set(after.overwritesStaffUserIds ?? []);
    const addedStaff = Array.from(afterStaff).filter((id) => !beforeStaff.has(id));
    if (addedStaff.length > 0) {
      const eventType: TicketEventType = beforeStaff.size > 0 ? 'REASSIGNED' : 'ASSIGNED';
      signals.push({
        eventType,
        targetStaffUserId: addedStaff[0],
        sourceEventId: `generic:overwrite:${after.channelId}:${addedStaff[0]}:${occurredAt}`,
        occurredAt,
        details: { addedStaff },
      });
    }

    return signals;
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

export function buildStandardDiagnostics(
  adapterId: string,
  adapterName: string,
  supportedEvents: readonly TicketEventType[],
  baseLimitations: readonly string[],
  permissionChecks: readonly ChannelPermissionCheck[],
  messageContentEnabled: boolean,
): AdapterDiagnosticResult {
  const missingPermissions: string[] = [];
  const channelIssues: string[] = [];

  if (permissionChecks.length === 0) {
    return {
      adapterId,
      adapterName,
      healthy: false,
      coverageLevel: 'UNAVAILABLE',
      supportedEvents: [...supportedEvents],
      observableLimitations: [...baseLimitations],
      missingPermissions: ['No ticket channels or categories have been configured yet (/ticket setup).'],
      channelIssues: ['0 configured ticket channels or categories.'],
    };
  }

  let accessibleCount = 0;
  for (const ch of permissionChecks) {
    if (!ch.exists) {
      channelIssues.push(`Configured ${ch.targetType} ${ch.channelName} (${ch.channelId}) no longer exists.`);
      continue;
    }
    if (!ch.canViewChannel || !ch.canReadHistory) {
      const missing: string[] = [];
      if (!ch.canViewChannel) missing.push('ViewChannel');
      if (!ch.canReadHistory) missing.push('ReadMessageHistory');
      missingPermissions.push(`${ch.channelName} (${ch.channelId}): missing ${missing.join(', ')}`);
      channelIssues.push(`${ch.channelName} (${ch.channelId}) is inaccessible to the bot.`);
    } else {
      accessibleCount += 1;
    }
  }

  const coverageLevel: 'FULL' | 'PARTIAL' | 'UNAVAILABLE' =
    accessibleCount === permissionChecks.length
      ? 'FULL'
      : accessibleCount > 0
        ? 'PARTIAL'
        : 'UNAVAILABLE';

  const limitations = [...baseLimitations];
  if (!messageContentEnabled) {
    limitations.push(
      'MessageContent intent is currently disabled (recommended default): embed metadata, channel events, and message headers are inspected without reading unmentioned plain-text bodies.',
    );
  }

  return {
    adapterId,
    adapterName,
    healthy: coverageLevel === 'FULL' && missingPermissions.length === 0,
    coverageLevel,
    supportedEvents: [...supportedEvents],
    observableLimitations: limitations,
    missingPermissions,
    channelIssues,
  };
}
