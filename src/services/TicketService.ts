import { IRelationalDatabase } from '../database/connection';
import { MonitoringCoverageLevel } from '../config/theme';
import { TicketEventType, TicketRecord, TicketStatus } from '../types/domain';
import { generateEntityId, isValidSnowflake } from '../utils/ids';
import {
  AdapterDiagnosticResult,
  ChannelPermissionCheck,
  NormalizedTicketSignal,
  ObservableChannelContext,
  ObservableMessageContext,
} from '../tickets/ITicketAdapter';
import { TicketAdapterRegistry } from '../tickets/TicketAdapterRegistry';
import { ActivityClassifierService } from './ActivityClassifierService';
import { AuditService } from './AuditService';
import { FeatureService } from './FeatureService';
import { GuildConfigService } from './GuildConfigService';
import { RosterService } from './RosterService';

export interface TicketChannelConfigRecord {
  id: number;
  guild_id: string;
  target_type: 'CHANNEL' | 'CATEGORY' | 'THREAD_PARENT';
  channel_id: string;
  channel_name: string;
  adapter_type: string;
  custom_pattern: string | null;
  is_active: number;
  created_by: string;
  created_at: string;
}

export class TicketService {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly features: FeatureService;
  private readonly roster: RosterService;
  private readonly classifier: ActivityClassifierService;
  private readonly audit: AuditService;
  public readonly adapterRegistry: TicketAdapterRegistry;

  constructor(
    db: IRelationalDatabase,
    guildConfig: GuildConfigService,
    features: FeatureService,
    roster: RosterService,
    classifier: ActivityClassifierService,
    audit: AuditService,
    adapterRegistry = new TicketAdapterRegistry(),
  ) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.features = features;
    this.roster = roster;
    this.classifier = classifier;
    this.audit = audit;
    this.adapterRegistry = adapterRegistry;
  }

  public addTicketChannelConfig(
    guildId: string,
    actorUserId: string,
    input: {
      targetType: 'CHANNEL' | 'CATEGORY' | 'THREAD_PARENT';
      channelId: string;
      channelName: string;
      adapterType?: string;
      customPattern?: string | null;
    },
  ): { record: TicketChannelConfigRecord; adapterWarning?: string } {
    this.guildConfig.getGuildConfigOrThrow(guildId);
    if (!isValidSnowflake(input.channelId)) {
      throw new Error(`Invalid Discord Channel/Category ID: "${input.channelId}".`);
    }

    const requestedAdapter = input.adapterType ?? 'generic';
    const lookup = this.adapterRegistry.get(requestedAdapter);
    const effectiveAdapter = lookup.isSupported ? requestedAdapter : lookup.adapter.id;
    const now = new Date().toISOString();

    this.db.run(
      `INSERT INTO ticket_channels_config (
        guild_id, target_type, channel_id, channel_name, adapter_type, custom_pattern, is_active, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(guild_id, channel_id) DO UPDATE SET
        target_type = excluded.target_type,
        channel_name = excluded.channel_name,
        adapter_type = excluded.adapter_type,
        custom_pattern = excluded.custom_pattern,
        is_active = 1`,
      [
        guildId,
        input.targetType,
        input.channelId,
        input.channelName,
        effectiveAdapter,
        input.customPattern ?? null,
        actorUserId,
        now,
      ],
    );

    const record = this.db.get<TicketChannelConfigRecord>(
      'SELECT * FROM ticket_channels_config WHERE guild_id = ? AND channel_id = ?',
      [guildId, input.channelId],
    )!;

    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'TICKET',
      actionType: 'TICKET_CHANNEL_CONFIGURED',
      targetType: input.targetType,
      targetId: input.channelId,
      after: record,
    });

    return { record, adapterWarning: lookup.warning };
  }

  public removeTicketChannelConfig(guildId: string, actorUserId: string, channelId: string): boolean {
    const existing = this.db.get<TicketChannelConfigRecord>(
      'SELECT * FROM ticket_channels_config WHERE guild_id = ? AND channel_id = ?',
      [guildId, channelId],
    );
    if (!existing) return false;

    this.db.run('DELETE FROM ticket_channels_config WHERE guild_id = ? AND channel_id = ?', [guildId, channelId]);
    this.audit.log({
      guildId,
      actorUserId,
      actionCategory: 'TICKET',
      actionType: 'TICKET_CHANNEL_REMOVED',
      targetType: existing.target_type,
      targetId: channelId,
      before: existing,
    });
    return true;
  }

  public listTicketChannelConfigs(
    guildId: string,
    targetType?: 'CHANNEL' | 'CATEGORY' | 'THREAD_PARENT',
  ): TicketChannelConfigRecord[] {
    if (targetType) {
      return this.db.all<TicketChannelConfigRecord>(
        'SELECT * FROM ticket_channels_config WHERE guild_id = ? AND target_type = ? AND is_active = 1 ORDER BY id ASC',
        [guildId, targetType],
      );
    }
    return this.db.all<TicketChannelConfigRecord>(
      'SELECT * FROM ticket_channels_config WHERE guild_id = ? AND is_active = 1 ORDER BY id ASC',
      [guildId],
    );
  }

  public matchMonitoredChannel(
    guildId: string,
    channelId: string,
    parentId?: string | null,
    grandParentCategoryId?: string | null,
  ): TicketChannelConfigRecord | null {
    const configs = this.listTicketChannelConfigs(guildId);
    for (const cfg of configs) {
      if (cfg.target_type === 'CHANNEL' && cfg.channel_id === channelId) return cfg;
      if (cfg.target_type === 'THREAD_PARENT' && parentId && cfg.channel_id === parentId) return cfg;
      if (
        cfg.target_type === 'CATEGORY' &&
        (cfg.channel_id === parentId || cfg.channel_id === grandParentCategoryId)
      ) {
        return cfg;
      }
    }
    return null;
  }

  private isDuplicateEvent(sourceEventId?: string | null): boolean {
    if (!sourceEventId) return false;
    const row = this.db.get<{ id: number }>('SELECT id FROM ticket_events WHERE source_event_id = ?', [sourceEventId]);
    return Boolean(row);
  }

  public getOpenTicketByChannel(guildId: string, channelId: string): TicketRecord | undefined {
    return this.db.get<TicketRecord>(
      `SELECT * FROM ticket_records
       WHERE guild_id = ? AND channel_id = ?
       ORDER BY opened_at DESC LIMIT 1`,
      [guildId, channelId],
    );
  }

  public getTicketById(guildId: string, ticketId: string): TicketRecord | undefined {
    return this.db.get<TicketRecord>(
      'SELECT * FROM ticket_records WHERE guild_id = ? AND ticket_id = ?',
      [guildId, ticketId],
    );
  }

  public createTicket(input: {
    guildId: string;
    channelId: string;
    channelName: string;
    parentCategoryId?: string | null;
    isThread?: boolean;
    openerUserId?: string | null;
    adapterSource?: string;
    externalTicketRef?: string | null;
    sourceEventId?: string;
    openedAt?: string;
  }): { ticket: TicketRecord; deduplicated: boolean } {
    if (!this.features.isEnabled(input.guildId, 'ticket_monitoring')) {
      throw new Error('Ticket monitoring is currently disabled for this server.');
    }

    const sourceEventId = input.sourceEventId ?? `create:${input.guildId}:${input.channelId}`;
    if (this.isDuplicateEvent(sourceEventId)) {
      const existing = this.getOpenTicketByChannel(input.guildId, input.channelId)!;
      return { ticket: existing, deduplicated: true };
    }

    const existingOpen = this.db.get<TicketRecord>(
      `SELECT * FROM ticket_records
       WHERE guild_id = ? AND channel_id = ? AND status NOT IN ('CLOSED')
       ORDER BY opened_at DESC LIMIT 1`,
      [input.guildId, input.channelId],
    );
    if (existingOpen) {
      return { ticket: existingOpen, deduplicated: true };
    }

    const ticketId = generateEntityId('TKT');
    const openedAt = input.openedAt ?? new Date().toISOString();

    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO ticket_records (
          ticket_id, guild_id, channel_id, channel_name, parent_category_id, is_thread,
          external_ticket_ref, adapter_source, opener_user_id, status, opened_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
        [
          ticketId,
          input.guildId,
          input.channelId,
          input.channelName,
          input.parentCategoryId ?? null,
          input.isThread ? 1 : 0,
          input.externalTicketRef ?? null,
          input.adapterSource ?? 'generic',
          input.openerUserId ?? null,
          openedAt,
          openedAt,
        ],
      );

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, 'CREATED', ?, ?, ?)`,
        [
          ticketId,
          input.guildId,
          input.openerUserId ?? null,
          sourceEventId,
          JSON.stringify({ channelName: input.channelName }),
          openedAt,
        ],
      );
    });

    return {
      ticket: this.getTicketById(input.guildId, ticketId)!,
      deduplicated: false,
    };
  }

  /**
   * Claims a ticket. IMPORTANT: Claiming a ticket updates assignment/workload,
   * but does NOT count as qualifying staff work or a handled ticket!
   */
  public claimTicket(input: {
    guildId: string;
    ticketId: string;
    staffUserId: string;
    sourceEventId?: string;
    occurredAt?: string;
  }): { ticket: TicketRecord; deduplicated: boolean } {
    if (input.sourceEventId && this.isDuplicateEvent(input.sourceEventId)) {
      return { ticket: this.getTicketById(input.guildId, input.ticketId)!, deduplicated: true };
    }

    const ticket = this.getTicketById(input.guildId, input.ticketId);
    if (!ticket) throw new Error(`Ticket ${input.ticketId} not found in server ${input.guildId}.`);

    const now = input.occurredAt ?? new Date().toISOString();

    this.db.transaction(() => {
      const nextStatus: TicketStatus =
        ticket.status === 'OPEN' ? 'CLAIMED' : ticket.status;

      this.db.run(
        `UPDATE ticket_records SET
          claimed_by_user_id = ?,
          assigned_to_user_id = COALESCE(assigned_to_user_id, ?),
          status = ?,
          updated_at = ?
        WHERE guild_id = ? AND ticket_id = ?`,
        [input.staffUserId, input.staffUserId, nextStatus, now, input.guildId, input.ticketId],
      );

      this.db.run(
        `INSERT INTO ticket_assignments (
          ticket_id, guild_id, staff_user_id, assignment_type, assigned_by, assigned_at, is_current, completed_meaningful_work
        ) VALUES (?, ?, ?, 'CLAIMED', ?, ?, 1, 0)`,
        [input.ticketId, input.guildId, input.staffUserId, input.staffUserId, now],
      );

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, 'CLAIMED', ?, ?, ?)`,
        [
          input.ticketId,
          input.guildId,
          input.staffUserId,
          input.sourceEventId ?? null,
          JSON.stringify({ note: 'Claimed only; awaiting meaningful response/work' }),
          now,
        ],
      );

      this.recomputeStaffTicketMetrics(input.guildId, input.staffUserId);
    });

    return {
      ticket: this.getTicketById(input.guildId, input.ticketId)!,
      deduplicated: false,
    };
  }

  public assignOrReassignTicket(input: {
    guildId: string;
    ticketId: string;
    staffUserId: string;
    actorUserId?: string | null;
    isOwnershipChange?: boolean;
    sourceEventId?: string;
    occurredAt?: string;
  }): { ticket: TicketRecord; deduplicated: boolean } {
    if (input.sourceEventId && this.isDuplicateEvent(input.sourceEventId)) {
      return { ticket: this.getTicketById(input.guildId, input.ticketId)!, deduplicated: true };
    }

    const ticket = this.getTicketById(input.guildId, input.ticketId);
    if (!ticket) throw new Error(`Ticket ${input.ticketId} not found in server ${input.guildId}.`);

    const previousAssignee = ticket.assigned_to_user_id;
    const isReassign = Boolean(previousAssignee && previousAssignee !== input.staffUserId);
    const eventType: TicketEventType = input.isOwnershipChange
      ? 'OWNERSHIP_CHANGED'
      : isReassign
        ? 'REASSIGNED'
        : 'ASSIGNED';
    const now = input.occurredAt ?? new Date().toISOString();

    this.db.transaction(() => {
      if (isReassign) {
        this.db.run(
          `UPDATE ticket_assignments SET is_current = 0, unassigned_at = ?
           WHERE guild_id = ? AND ticket_id = ? AND is_current = 1`,
          [now, input.guildId, input.ticketId],
        );
      }

      const nextStatus: TicketStatus =
        ticket.status === 'OPEN' || ticket.status === 'CLAIMED' ? 'ASSIGNED' : ticket.status;

      this.db.run(
        `UPDATE ticket_records SET
          assigned_to_user_id = ?,
          status = ?,
          updated_at = ?
        WHERE guild_id = ? AND ticket_id = ?`,
        [input.staffUserId, nextStatus, now, input.guildId, input.ticketId],
      );

      this.db.run(
        `INSERT INTO ticket_assignments (
          ticket_id, guild_id, staff_user_id, assignment_type, assigned_by, assigned_at, is_current, completed_meaningful_work
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 0)`,
        [
          input.ticketId,
          input.guildId,
          input.staffUserId,
          isReassign ? 'REASSIGNED' : 'ASSIGNED',
          input.actorUserId ?? null,
          now,
        ],
      );

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.ticketId,
          input.guildId,
          input.actorUserId ?? input.staffUserId,
          eventType,
          input.sourceEventId ?? null,
          JSON.stringify({ previousAssignee, newAssignee: input.staffUserId }),
          now,
        ],
      );

      this.recomputeStaffTicketMetrics(input.guildId, input.staffUserId);
      if (previousAssignee && previousAssignee !== input.staffUserId) {
        this.recomputeStaffTicketMetrics(input.guildId, previousAssignee);
      }
    });

    return {
      ticket: this.getTicketById(input.guildId, input.ticketId)!,
      deduplicated: false,
    };
  }

  /**
   * Processes a message sent in a ticket channel/thread.
   * Ignores bots/webhooks for staff work, evaluates meaningfulness via ActivityClassifierService,
   * and updates first-response time, handled count, and workload accurately.
   */
  public recordTicketStaffMessage(input: {
    guildId: string;
    ticketId: string;
    staffUserId: string;
    channelId: string;
    messageId: string;
    content?: string | null;
    contentAvailable?: boolean;
    attachmentCount?: number;
    isBot?: boolean;
    isWebhook?: boolean;
    occurredAt?: string;
  }): {
    ticket: TicketRecord;
    qualifyingWork: boolean;
    isFirstResponse: boolean;
    deduplicated: boolean;
  } {
    const sourceEventId = `msg:${input.messageId}`;
    const ticket = this.getTicketById(input.guildId, input.ticketId);
    if (!ticket) throw new Error(`Ticket ${input.ticketId} not found.`);

    if (this.isDuplicateEvent(sourceEventId)) {
      return {
        ticket,
        qualifyingWork: false,
        isFirstResponse: false,
        deduplicated: true,
      };
    }

    if (input.isBot || input.isWebhook || !this.roster.isActiveStaffMember(input.guildId, input.staffUserId)) {
      return {
        ticket,
        qualifyingWork: false,
        isFirstResponse: false,
        deduplicated: false,
      };
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const isCandidateFirstResponse = ticket.first_staff_response_at === null;

    const classification = this.classifier.evaluateMessageActivity({
      guildId: input.guildId,
      userId: input.staffUserId,
      channelId: input.channelId,
      messageId: input.messageId,
      content: input.content,
      contentAvailable: input.contentAvailable,
      attachmentCount: input.attachmentCount,
      isBot: input.isBot,
      isWebhook: input.isWebhook,
      isTicketChannel: true,
      ticketId: input.ticketId,
      isFirstTicketResponse: isCandidateFirstResponse,
      occurredAt,
    });

    if (!classification.isQualifying) {
      this.db.run(
        'UPDATE ticket_records SET staff_message_count = staff_message_count + 1, updated_at = ? WHERE guild_id = ? AND ticket_id = ?',
        [occurredAt, input.guildId, input.ticketId],
      );
      return {
        ticket: this.getTicketById(input.guildId, input.ticketId)!,
        qualifyingWork: false,
        isFirstResponse: false,
        deduplicated: false,
      };
    }

    const openedMs = Date.parse(ticket.opened_at);
    const respMs = Date.parse(occurredAt);
    const elapsedSec =
      Number.isFinite(openedMs) && Number.isFinite(respMs) ? Math.max(0, (respMs - openedMs) / 1000) : null;

    let didFirstResponse = false;

    this.db.transaction(() => {
      if (isCandidateFirstResponse) {
        didFirstResponse = true;
        this.db.run(
          `UPDATE ticket_records SET
            first_staff_response_at = ?,
            first_response_staff_id = ?,
            first_response_sec = ?,
            assigned_to_user_id = COALESCE(assigned_to_user_id, ?),
            status = CASE WHEN status IN ('OPEN','CLAIMED','ASSIGNED') THEN 'IN_PROGRESS' ELSE status END,
            staff_message_count = staff_message_count + 1,
            meaningful_response_count = meaningful_response_count + 1,
            updated_at = ?
          WHERE guild_id = ? AND ticket_id = ?`,
          [
            occurredAt,
            input.staffUserId,
            elapsedSec,
            input.staffUserId,
            occurredAt,
            input.guildId,
            input.ticketId,
          ],
        );
      } else {
        this.db.run(
          `UPDATE ticket_records SET
            assigned_to_user_id = COALESCE(assigned_to_user_id, ?),
            status = CASE WHEN status IN ('OPEN','CLAIMED','ASSIGNED') THEN 'IN_PROGRESS' ELSE status END,
            staff_message_count = staff_message_count + 1,
            meaningful_response_count = meaningful_response_count + 1,
            updated_at = ?
          WHERE guild_id = ? AND ticket_id = ?`,
          [input.staffUserId, occurredAt, input.guildId, input.ticketId],
        );
      }

      const existingAssignment = this.db.get<{ id: number }>(
        'SELECT id FROM ticket_assignments WHERE guild_id = ? AND ticket_id = ? AND staff_user_id = ?',
        [input.guildId, input.ticketId, input.staffUserId],
      );
      if (existingAssignment) {
        this.db.run(
          'UPDATE ticket_assignments SET completed_meaningful_work = 1 WHERE guild_id = ? AND ticket_id = ? AND staff_user_id = ?',
          [input.guildId, input.ticketId, input.staffUserId],
        );
      } else {
        this.db.run(
          `INSERT INTO ticket_assignments (
            ticket_id, guild_id, staff_user_id, assignment_type, assigned_at, is_current, completed_meaningful_work
          ) VALUES (?, ?, ?, 'COLLABORATOR', ?, 1, 1)`,
          [input.ticketId, input.guildId, input.staffUserId, occurredAt],
        );
      }

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.ticketId,
          input.guildId,
          input.staffUserId,
          didFirstResponse ? 'FIRST_RESPONSE' : 'STAFF_RESPONSE',
          sourceEventId,
          JSON.stringify({ elapsedSec }),
          occurredAt,
        ],
      );

      this.recomputeStaffTicketMetrics(input.guildId, input.staffUserId);
    });

    return {
      ticket: this.getTicketById(input.guildId, input.ticketId)!,
      qualifyingWork: true,
      isFirstResponse: didFirstResponse,
      deduplicated: false,
    };
  }

  public resolveTicket(input: {
    guildId: string;
    ticketId: string;
    staffUserId?: string | null;
    sourceEventId?: string;
    occurredAt?: string;
  }): { ticket: TicketRecord; deduplicated: boolean } {
    if (input.sourceEventId && this.isDuplicateEvent(input.sourceEventId)) {
      return { ticket: this.getTicketById(input.guildId, input.ticketId)!, deduplicated: true };
    }

    const ticket = this.getTicketById(input.guildId, input.ticketId);
    if (!ticket) throw new Error(`Ticket ${input.ticketId} not found.`);

    const now = input.occurredAt ?? new Date().toISOString();
    const resolverId = input.staffUserId ?? ticket.assigned_to_user_id ?? ticket.first_response_staff_id ?? null;

    const openedMs = Date.parse(ticket.opened_at);
    const resolvedMs = Date.parse(now);
    const resolutionSec =
      Number.isFinite(openedMs) && Number.isFinite(resolvedMs)
        ? Math.max(0, (resolvedMs - openedMs) / 1000)
        : null;

    this.db.transaction(() => {
      this.db.run(
        `UPDATE ticket_records SET
          resolved_by_user_id = COALESCE(?, resolved_by_user_id),
          status = 'RESOLVED',
          resolved_at = COALESCE(resolved_at, ?),
          resolution_sec = COALESCE(resolution_sec, ?),
          updated_at = ?
        WHERE guild_id = ? AND ticket_id = ?`,
        [resolverId, now, resolutionSec, now, input.guildId, input.ticketId],
      );

      if (resolverId) {
        const existingAssign = this.db.get<{ id: number }>(
          'SELECT id FROM ticket_assignments WHERE guild_id = ? AND ticket_id = ? AND staff_user_id = ?',
          [input.guildId, input.ticketId, resolverId],
        );
        if (existingAssign) {
          this.db.run(
            'UPDATE ticket_assignments SET completed_meaningful_work = 1 WHERE id = ?',
            [existingAssign.id],
          );
        } else {
          this.db.run(
            `INSERT INTO ticket_assignments (
              ticket_id, guild_id, staff_user_id, assignment_type, assigned_at, is_current, completed_meaningful_work
            ) VALUES (?, ?, ?, 'ASSIGNED', ?, 1, 1)`,
            [input.ticketId, input.guildId, resolverId, now],
          );
        }
      }

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, 'RESOLVED', ?, ?, ?)`,
        [
          input.ticketId,
          input.guildId,
          resolverId,
          input.sourceEventId ?? null,
          JSON.stringify({ resolutionSec }),
          now,
        ],
      );
    });

    if (resolverId) {
      this.classifier.recordExplicitStaffWork({
        guildId: input.guildId,
        userId: resolverId,
        eventType: 'TICKET_RESOLUTION',
        reason: `Resolved ticket ${input.ticketId}`,
        channelId: ticket.channel_id,
        ticketId: input.ticketId,
        metadata: { resolutionSec },
        occurredAt: now,
      });
      this.recomputeStaffTicketMetrics(input.guildId, resolverId);
    }
    if (ticket.assigned_to_user_id && ticket.assigned_to_user_id !== resolverId) {
      this.recomputeStaffTicketMetrics(input.guildId, ticket.assigned_to_user_id);
    }

    return {
      ticket: this.getTicketById(input.guildId, input.ticketId)!,
      deduplicated: false,
    };
  }

  public closeTicket(input: {
    guildId: string;
    ticketId: string;
    actorUserId?: string | null;
    sourceEventId?: string;
    occurredAt?: string;
  }): { ticket: TicketRecord; deduplicated: boolean } {
    if (input.sourceEventId && this.isDuplicateEvent(input.sourceEventId)) {
      return { ticket: this.getTicketById(input.guildId, input.ticketId)!, deduplicated: true };
    }

    const ticket = this.getTicketById(input.guildId, input.ticketId);
    if (!ticket) throw new Error(`Ticket ${input.ticketId} not found.`);

    const now = input.occurredAt ?? new Date().toISOString();
    const openedMs = Date.parse(ticket.opened_at);
    const closedMs = Date.parse(now);
    const resolutionSec =
      ticket.resolution_sec ??
      (Number.isFinite(openedMs) && Number.isFinite(closedMs) ? Math.max(0, (closedMs - openedMs) / 1000) : null);

    // If ticket had meaningful staff responses before closure and wasn't explicitly resolved yet,
    // credit resolution to the active staff responder/assignee; never credit if merely claimed with 0 responses!
    const effectiveResolver =
      ticket.resolved_by_user_id ??
      (ticket.meaningful_response_count > 0
        ? (input.actorUserId && this.roster.isActiveStaffMember(input.guildId, input.actorUserId)
            ? input.actorUserId
            : ticket.assigned_to_user_id ?? ticket.first_response_staff_id)
        : null);

    this.db.transaction(() => {
      this.db.run(
        `UPDATE ticket_records SET
          status = 'CLOSED',
          closed_at = ?,
          resolved_at = COALESCE(resolved_at, CASE WHEN ? IS NOT NULL THEN ? ELSE NULL END),
          resolved_by_user_id = COALESCE(resolved_by_user_id, ?),
          resolution_sec = ?,
          updated_at = ?
        WHERE guild_id = ? AND ticket_id = ?`,
        [now, effectiveResolver, now, effectiveResolver, resolutionSec, now, input.guildId, input.ticketId],
      );

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, 'CLOSED', ?, ?, ?)`,
        [
          input.ticketId,
          input.guildId,
          input.actorUserId ?? null,
          input.sourceEventId ?? null,
          JSON.stringify({ resolutionSec }),
          now,
        ],
      );
    });

    if (effectiveResolver) {
      this.recomputeStaffTicketMetrics(input.guildId, effectiveResolver);
    }
    if (ticket.assigned_to_user_id && ticket.assigned_to_user_id !== effectiveResolver) {
      this.recomputeStaffTicketMetrics(input.guildId, ticket.assigned_to_user_id);
    }

    return {
      ticket: this.getTicketById(input.guildId, input.ticketId)!,
      deduplicated: false,
    };
  }

  public reopenTicket(input: {
    guildId: string;
    ticketId: string;
    actorUserId?: string | null;
    sourceEventId?: string;
    occurredAt?: string;
  }): { ticket: TicketRecord; deduplicated: boolean } {
    if (input.sourceEventId && this.isDuplicateEvent(input.sourceEventId)) {
      return { ticket: this.getTicketById(input.guildId, input.ticketId)!, deduplicated: true };
    }

    const ticket = this.getTicketById(input.guildId, input.ticketId);
    if (!ticket) throw new Error(`Ticket ${input.ticketId} not found.`);

    const now = input.occurredAt ?? new Date().toISOString();

    this.db.transaction(() => {
      this.db.run(
        `UPDATE ticket_records SET
          status = 'REOPENED',
          closed_at = NULL,
          reopened_count = reopened_count + 1,
          updated_at = ?
        WHERE guild_id = ? AND ticket_id = ?`,
        [now, input.guildId, input.ticketId],
      );

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, 'REOPENED', ?, '{}', ?)`,
        [input.ticketId, input.guildId, input.actorUserId ?? null, input.sourceEventId ?? null, now],
      );
    });

    if (ticket.assigned_to_user_id) {
      this.recomputeStaffTicketMetrics(input.guildId, ticket.assigned_to_user_id);
    }

    return {
      ticket: this.getTicketById(input.guildId, input.ticketId)!,
      deduplicated: false,
    };
  }

  /**
   * Processes normalized signals emitted by any registered ITicketAdapter.
   */
  public applyAdapterSignals(
    guildId: string,
    channelCtx: ObservableChannelContext,
    adapterId: string,
    signals: readonly NormalizedTicketSignal[],
  ): void {
    if (signals.length === 0) return;
    if (!this.features.isEnabled(guildId, 'ticket_monitoring')) return;
    if (adapterId !== 'generic' && !this.features.isEnabled(guildId, 'ticket_integrations')) return;

    for (const signal of signals) {
      if (signal.eventType === 'CREATED') {
        this.createTicket({
          guildId,
          channelId: channelCtx.channelId,
          channelName: channelCtx.channelName,
          parentCategoryId: channelCtx.parentCategoryId,
          isThread: channelCtx.isThread,
          openerUserId: signal.openerUserId,
          adapterSource: adapterId,
          externalTicketRef: signal.externalTicketRef,
          sourceEventId: signal.sourceEventId,
          openedAt: signal.occurredAt,
        });
        continue;
      }

      let ticket = this.getOpenTicketByChannel(guildId, channelCtx.channelId);
      if (!ticket) {
        ticket = this.createTicket({
          guildId,
          channelId: channelCtx.channelId,
          channelName: channelCtx.channelName,
          parentCategoryId: channelCtx.parentCategoryId,
          isThread: channelCtx.isThread,
          adapterSource: adapterId,
          openedAt: signal.occurredAt,
        }).ticket;
      }

      switch (signal.eventType) {
        case 'CLAIMED':
          if (signal.targetStaffUserId || signal.actorUserId) {
            this.claimTicket({
              guildId,
              ticketId: ticket.ticket_id,
              staffUserId: (signal.targetStaffUserId ?? signal.actorUserId)!,
              sourceEventId: signal.sourceEventId,
              occurredAt: signal.occurredAt,
            });
          }
          break;
        case 'ASSIGNED':
        case 'REASSIGNED':
        case 'OWNERSHIP_CHANGED':
          if (signal.targetStaffUserId) {
            this.assignOrReassignTicket({
              guildId,
              ticketId: ticket.ticket_id,
              staffUserId: signal.targetStaffUserId,
              actorUserId: signal.actorUserId,
              isOwnershipChange: signal.eventType === 'OWNERSHIP_CHANGED',
              sourceEventId: signal.sourceEventId,
              occurredAt: signal.occurredAt,
            });
          }
          break;
        case 'RESOLVED':
          this.resolveTicket({
            guildId,
            ticketId: ticket.ticket_id,
            staffUserId: signal.actorUserId,
            sourceEventId: signal.sourceEventId,
            occurredAt: signal.occurredAt,
          });
          break;
        case 'CLOSED':
          this.closeTicket({
            guildId,
            ticketId: ticket.ticket_id,
            actorUserId: signal.actorUserId,
            sourceEventId: signal.sourceEventId,
            occurredAt: signal.occurredAt,
          });
          break;
        case 'REOPENED':
          this.reopenTicket({
            guildId,
            ticketId: ticket.ticket_id,
            actorUserId: signal.actorUserId,
            sourceEventId: signal.sourceEventId,
            occurredAt: signal.occurredAt,
          });
          break;
        default:
          break;
      }
    }
  }

  public handleBotAdapterMessage(msg: ObservableMessageContext): void {
    const cfg = this.matchMonitoredChannel(msg.guildId, msg.channelId, msg.parentCategoryId);
    if (!cfg) return;
    if (!this.features.isEnabled(msg.guildId, 'ticket_monitoring')) return;
    if (cfg.adapter_type !== 'generic' && !this.features.isEnabled(msg.guildId, 'ticket_integrations')) return;

    const { adapter } = this.adapterRegistry.get(cfg.adapter_type);
    const signals = adapter.inspectBotMessage(msg);
    this.applyAdapterSignals(
      msg.guildId,
      {
        guildId: msg.guildId,
        channelId: msg.channelId,
        channelName: msg.channelName,
        parentCategoryId: msg.parentCategoryId,
        isThread: msg.isThread,
      },
      adapter.id,
      signals,
    );
  }

  public recomputeStaffTicketMetrics(guildId: string, staffUserId: string): void {
    const assignedRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(DISTINCT ticket_id) AS cnt
       FROM ticket_assignments
       WHERE guild_id = ? AND staff_user_id = ?`,
      [guildId, staffUserId],
    );

    const handledRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(DISTINCT ticket_id) AS cnt
       FROM ticket_assignments
       WHERE guild_id = ? AND staff_user_id = ? AND completed_meaningful_work = 1`,
      [guildId, staffUserId],
    );

    const resolvedRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt
       FROM ticket_records
       WHERE guild_id = ? AND resolved_by_user_id = ? AND status IN ('RESOLVED', 'CLOSED')`,
      [guildId, staffUserId],
    );

    const workloadRow = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt
       FROM ticket_records
       WHERE guild_id = ? AND assigned_to_user_id = ?
         AND status IN ('OPEN', 'CLAIMED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED')`,
      [guildId, staffUserId],
    );

    const firstRespAvgRow = this.db.get<{ avg_sec: number | null }>(
      `SELECT AVG(first_response_sec) AS avg_sec
       FROM ticket_records
       WHERE guild_id = ? AND first_response_staff_id = ? AND first_response_sec IS NOT NULL`,
      [guildId, staffUserId],
    );

    const resolutionAvgRow = this.db.get<{ avg_sec: number | null }>(
      `SELECT AVG(resolution_sec) AS avg_sec
       FROM ticket_records
       WHERE guild_id = ? AND resolved_by_user_id = ? AND resolution_sec IS NOT NULL`,
      [guildId, staffUserId],
    );

    const now = new Date().toISOString();
    this.db.run(
      `UPDATE staff_profiles SET
        assigned_tickets_count = ?,
        tickets_handled_count = ?,
        tickets_resolved_count = ?,
        current_workload = ?,
        avg_first_response_sec = ?,
        avg_response_sec = COALESCE(?, avg_response_sec),
        avg_resolution_sec = ?,
        updated_at = ?
      WHERE guild_id = ? AND user_id = ?`,
      [
        assignedRow?.cnt ?? 0,
        handledRow?.cnt ?? 0,
        resolvedRow?.cnt ?? 0,
        workloadRow?.cnt ?? 0,
        firstRespAvgRow?.avg_sec ?? null,
        firstRespAvgRow?.avg_sec ?? null,
        resolutionAvgRow?.avg_sec ?? null,
        now,
        guildId,
        staffUserId,
      ],
    );
  }

  /**
   * Counts available open/unassigned tickets or active work opportunities in the guild
   * during `[sinceIso, nowIso]` so staff are never marked inactive when 0 workload existed!
   */
  public countAvailableGuildWorkload(guildId: string, sinceIso?: string): number {
    if (sinceIso) {
      const row = this.db.get<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM ticket_records
         WHERE guild_id = ?
           AND (
             status IN ('OPEN', 'REOPENED')
             OR opened_at >= ?
             OR updated_at >= ?
           )`,
        [guildId, sinceIso, sinceIso],
      );
      return row?.cnt ?? 0;
    }

    const row = this.db.get<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ticket_records
       WHERE guild_id = ? AND status IN ('OPEN', 'CLAIMED', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED')`,
      [guildId],
    );
    return row?.cnt ?? 0;
  }

  public getGuildTicketSummary(guildId: string): {
    totalTickets: number;
    openTickets: number;
    inProgressTickets: number;
    resolvedTickets: number;
    closedTickets: number;
    reopenedTickets: number;
    avgFirstResponseSec: number | null;
    avgResolutionSec: number | null;
  } {
    const row = this.db.get<{
      total: number;
      open_cnt: number;
      prog_cnt: number;
      res_cnt: number;
      closed_cnt: number;
      reopen_sum: number | null;
      avg_first: number | null;
      avg_res: number | null;
    }>(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_cnt,
        SUM(CASE WHEN status IN ('CLAIMED','ASSIGNED','IN_PROGRESS','REOPENED') THEN 1 ELSE 0 END) AS prog_cnt,
        SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) AS res_cnt,
        SUM(CASE WHEN status = 'CLOSED' THEN 1 ELSE 0 END) AS closed_cnt,
        SUM(reopened_count) AS reopen_sum,
        AVG(first_response_sec) AS avg_first,
        AVG(resolution_sec) AS avg_res
      FROM ticket_records
      WHERE guild_id = ?`,
      [guildId],
    );

    return {
      totalTickets: row?.total ?? 0,
      openTickets: row?.open_cnt ?? 0,
      inProgressTickets: row?.prog_cnt ?? 0,
      resolvedTickets: row?.res_cnt ?? 0,
      closedTickets: row?.closed_cnt ?? 0,
      reopenedTickets: row?.reopen_sum ?? 0,
      avgFirstResponseSec: row?.avg_first ?? null,
      avgResolutionSec: row?.avg_res ?? null,
    };
  }

  public listRecentTickets(guildId: string, limit = 15, status?: TicketStatus): TicketRecord[] {
    if (status) {
      return this.db.all<TicketRecord>(
        'SELECT * FROM ticket_records WHERE guild_id = ? AND status = ? ORDER BY updated_at DESC LIMIT ?',
        [guildId, status, limit],
      );
    }
    return this.db.all<TicketRecord>(
      'SELECT * FROM ticket_records WHERE guild_id = ? ORDER BY updated_at DESC LIMIT ?',
      [guildId, limit],
    );
  }

  public runDiagnostics(
    guildId: string,
    livePermissionChecks?: readonly ChannelPermissionCheck[],
    messageContentEnabled = false,
  ): {
    coverageLevel: MonitoringCoverageLevel;
    adapterReports: AdapterDiagnosticResult[];
    accessibleCount: number;
    inaccessibleCount: number;
  } {
    const configs = this.listTicketChannelConfigs(guildId);
    const checks: ChannelPermissionCheck[] =
      livePermissionChecks && livePermissionChecks.length > 0
        ? [...livePermissionChecks]
        : configs.map((c) => ({
            channelId: c.channel_id,
            channelName: c.channel_name,
            targetType: c.target_type,
            exists: true,
            canViewChannel: true,
            canReadHistory: true,
            canSendMessages: true,
          }));

    const adapterIds = new Set(configs.map((c) => c.adapter_type));
    if (adapterIds.size === 0) adapterIds.add('generic');

    const adapterReports: AdapterDiagnosticResult[] = [];
    for (const adapterId of adapterIds) {
      const lookup = this.adapterRegistry.get(adapterId);
      const report = lookup.adapter.diagnose(guildId, checks, messageContentEnabled);
      if (lookup.warning) {
        report.observableLimitations.unshift(lookup.warning);
      }
      adapterReports.push(report);
    }

    const accessibleCount = checks.filter((c) => c.exists && c.canViewChannel && c.canReadHistory).length;
    const inaccessibleCount = checks.length - accessibleCount;
    const coverageLevel: MonitoringCoverageLevel =
      checks.length === 0
        ? 'UNAVAILABLE'
        : accessibleCount === checks.length
          ? 'FULL'
          : accessibleCount > 0
            ? 'PARTIAL'
            : 'UNAVAILABLE';

    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO monitoring_health (
        guild_id, component, status, coverage_level, accessible_channels, inaccessible_channels, error_details, checked_at
      ) VALUES (?, 'TICKET_ENGINE', ?, ?, ?, ?, ?, ?)`,
      [
        guildId,
        coverageLevel === 'FULL' ? 'HEALTHY' : coverageLevel === 'PARTIAL' ? 'DEGRADED' : 'ERROR',
        coverageLevel,
        accessibleCount,
        inaccessibleCount,
        inaccessibleCount > 0 ? `${inaccessibleCount} configured channel(s) inaccessible` : null,
        now,
      ],
    );

    return {
      coverageLevel,
      adapterReports,
      accessibleCount,
      inaccessibleCount,
    };
  }
}
