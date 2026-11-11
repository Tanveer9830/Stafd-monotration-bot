import { IRelationalDatabase } from '../database/connection';
import { TicketRecord } from '../types/domain';
import { generateEntityId } from '../utils/ids';
import { logger } from '../utils/logger';
import { AuditService } from './AuditService';
import { PlatformEventBus } from './PlatformEventBus';
import { RosterService } from './RosterService';
import { SystemSettingsService } from './SystemSettingsService';
import { TicketClaimTimerRecord, TicketService } from './TicketService';

export interface AutoClaimResult {
  executed: number;
  cancelled: number;
  failed: number;
  skipped: number;
}

/**
 * Implements the five-minute first-responder automatic claim rule.
 *
 * 1. A ticket has no owner.
 * 2. A staff member sends the first meaningful response.
 * 3. A persistent timer is scheduled (default 5 minutes, configurable).
 * 4. Manual claims / assignment / closure / resolution cancel the timer.
 * 5. At expiry the ticket is atomically assigned to the first responder,
 *    but only if it is still unowned and the responder is still eligible.
 */
export class AutoClaimService {
  private readonly db: IRelationalDatabase;
  private readonly tickets: TicketService;
  private readonly roster: RosterService;
  private readonly audit: AuditService;
  private readonly settings: SystemSettingsService;
  private readonly eventBus: PlatformEventBus;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    db: IRelationalDatabase,
    tickets: TicketService,
    roster: RosterService,
    audit: AuditService,
    settings: SystemSettingsService,
    eventBus: PlatformEventBus,
  ) {
    this.db = db;
    this.tickets = tickets;
    this.roster = roster;
    this.audit = audit;
    this.settings = settings;
    this.eventBus = eventBus;

    this.tickets.setFirstResponseHandler((info) => {
      this.scheduleForFirstResponse(info);
    });
  }

  public getDelayMinutes(): number {
    return this.settings.getNumber('ticket_auto_claim_minutes');
  }

  /** Schedules the five-minute timer. Idempotent per ticket. */
  public scheduleForFirstResponse(input: {
    guildId: string;
    ticketId: string;
    staffUserId: string;
    occurredAt: string;
    nowIso?: string;
  }): TicketClaimTimerRecord | null {
    const ticket = this.tickets.getTicketById(input.guildId, input.ticketId);
    if (!ticket) return null;
    if (this.isTicketOwned(ticket)) return null;
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return null;

    const existing = this.db.get<TicketClaimTimerRecord>(
      `SELECT * FROM ticket_claim_timers WHERE ticket_id = ? AND status = 'PENDING'`,
      [input.ticketId],
    );
    if (existing) return existing;

    const now = input.nowIso ?? new Date().toISOString();
    const executeAt = new Date(Date.parse(input.occurredAt) + this.getDelayMinutes() * 60_000).toISOString();
    const timerId = generateEntityId('ACM');

    try {
      this.db.run(
        `INSERT INTO ticket_claim_timers (
          timer_id, guild_id, ticket_id, first_responder_user_id, first_response_at,
          execute_at, status, attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?)`,
        [timerId, input.guildId, input.ticketId, input.staffUserId, input.occurredAt, executeAt, now, now],
      );
    } catch {
      // A concurrent first response already created the pending timer.
      return this.db.get<TicketClaimTimerRecord>(
        `SELECT * FROM ticket_claim_timers WHERE ticket_id = ? AND status = 'PENDING'`,
        [input.ticketId],
      ) ?? null;
    }

    this.audit.log({
      guildId: input.guildId,
      actorUserId: input.staffUserId,
      actionCategory: 'TICKET',
      actionType: 'AUTO_CLAIM_SCHEDULED',
      targetType: 'TICKET',
      targetId: input.ticketId,
      metadata: { executeAt, delayMinutes: this.getDelayMinutes(), firstResponder: input.staffUserId },
    });
    this.eventBus.publish({
      type: 'ticket.auto_claim_scheduled',
      guildId: input.guildId,
      ticketId: input.ticketId,
      at: now,
      data: { firstResponderUserId: input.staffUserId, executeAt },
    });

    return this.db.get<TicketClaimTimerRecord>(
      'SELECT * FROM ticket_claim_timers WHERE timer_id = ?',
      [timerId],
    ) ?? null;
  }

  public cancelForTicket(guildId: string, ticketId: string, reason: string, nowIso = new Date().toISOString()): number {
    const changes = this.tickets.cancelPendingAutoClaim(ticketId, reason, nowIso);
    if (changes > 0) {
      this.audit.log({
        guildId,
        actorUserId: 'SYSTEM',
        actionCategory: 'TICKET',
        actionType: 'AUTO_CLAIM_CANCELLED',
        targetType: 'TICKET',
        targetId: ticketId,
        metadata: { reason },
      });
    }
    return changes;
  }

  public getPendingTimer(ticketId: string): TicketClaimTimerRecord | undefined {
    return this.db.get<TicketClaimTimerRecord>(
      `SELECT * FROM ticket_claim_timers WHERE ticket_id = ? AND status = 'PENDING'`,
      [ticketId],
    );
  }

  /**
   * Processes all due timers. Safe to call from a scheduler tick and on startup.
   * Each timer is executed in an atomic transaction with a status guard, so
   * concurrent schedulers can never produce duplicate auto claims.
   */
  public processDueTimers(nowIso = new Date().toISOString()): AutoClaimResult {
    const result: AutoClaimResult = { executed: 0, cancelled: 0, failed: 0, skipped: 0 };
    const due = this.db.all<TicketClaimTimerRecord>(
      `SELECT * FROM ticket_claim_timers
       WHERE status = 'PENDING' AND execute_at <= ?
       ORDER BY execute_at ASC LIMIT 100`,
      [nowIso],
    );

    for (const timer of due) {
      try {
        const outcome = this.executeTimer(timer.timer_id, nowIso);
        result[outcome] += 1;
      } catch (err) {
        result.failed += 1;
        const message = err instanceof Error ? err.message : String(err);
        this.db.run(
          `UPDATE ticket_claim_timers SET status = 'FAILED', failure_reason = ?, attempts = attempts + 1,
             updated_at = ? WHERE timer_id = ? AND status = 'PENDING'`,
          [message, nowIso, timer.timer_id],
        );
        logger.error({ err, timerId: timer.timer_id }, 'Automatic claim timer failed');
        this.audit.log({
          guildId: timer.guild_id,
          actorUserId: 'SYSTEM',
          actionCategory: 'TICKET',
          actionType: 'AUTO_CLAIM_FAILED',
          targetType: 'TICKET',
          targetId: timer.ticket_id,
          metadata: { error: message },
        });
      }
    }

    return result;
  }

  /** Cleans up orphaned pending timers (ticket already owned or finished). */
  public reconcileOrphanedTimers(nowIso = new Date().toISOString()): number {
    const pending = this.db.all<TicketClaimTimerRecord>(
      `SELECT * FROM ticket_claim_timers WHERE status = 'PENDING'`,
    );
    let cancelled = 0;
    for (const timer of pending) {
      const ticket = this.tickets.getTicketById(timer.guild_id, timer.ticket_id);
      if (!ticket) {
        this.db.run(
          `UPDATE ticket_claim_timers SET status = 'CANCELLED', cancel_reason = 'TICKET_MISSING', updated_at = ?
           WHERE timer_id = ? AND status = 'PENDING'`,
          [nowIso, timer.timer_id],
        );
        cancelled += 1;
        continue;
      }
      if (this.isTicketOwned(ticket) || ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        this.db.run(
          `UPDATE ticket_claim_timers SET status = 'CANCELLED',
             cancel_reason = ?, updated_at = ?
           WHERE timer_id = ? AND status = 'PENDING'`,
          [this.isTicketOwned(ticket) ? 'TICKET_ALREADY_OWNED' : 'TICKET_FINALIZED', nowIso, timer.timer_id],
        );
        cancelled += 1;
      }
    }
    return cancelled;
  }

  /** Called on startup: recover persisted timers across bot restarts. */
  public recoverPendingTimers(nowIso = new Date().toISOString()): AutoClaimResult {
    this.reconcileOrphanedTimers(nowIso);
    return this.processDueTimers(nowIso);
  }

  public start(intervalMs = 30_000): void {
    if (this.timer) return;
    this.recoverPendingTimers();
    this.timer = setInterval(() => {
      try {
        this.recoverPendingTimers();
      } catch (err) {
        logger.error({ err }, 'Auto-claim scheduler tick failed');
      }
    }, Math.max(5_000, intervalMs));
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private executeTimer(timerId: string, nowIso: string): 'executed' | 'cancelled' | 'skipped' {
    return this.db.transaction(() => {
      const timer = this.db.get<TicketClaimTimerRecord>(
        `SELECT * FROM ticket_claim_timers WHERE timer_id = ? AND status = 'PENDING'`,
        [timerId],
      );
      if (!timer) return 'skipped' as const;

      const ticket = this.tickets.getTicketById(timer.guild_id, timer.ticket_id);
      if (!ticket) {
        this.db.run(
          `UPDATE ticket_claim_timers SET status = 'CANCELLED', cancel_reason = 'TICKET_MISSING', updated_at = ?
           WHERE timer_id = ? AND status = 'PENDING'`,
          [nowIso, timerId],
        );
        return 'cancelled' as const;
      }

      const cancelReason = this.ineligibilityReason(timer, ticket);
      if (cancelReason) {
        this.db.run(
          `UPDATE ticket_claim_timers SET status = 'CANCELLED', cancel_reason = ?, updated_at = ?
           WHERE timer_id = ? AND status = 'PENDING'`,
          [cancelReason, nowIso, timerId],
        );
        this.audit.log({
          guildId: timer.guild_id,
          actorUserId: 'SYSTEM',
          actionCategory: 'TICKET',
          actionType: 'AUTO_CLAIM_CANCELLED',
          targetType: 'TICKET',
          targetId: timer.ticket_id,
          metadata: { reason: cancelReason },
        });
        return 'cancelled' as const;
      }

      const nextStatus = ticket.status === 'OPEN' ? 'IN_PROGRESS' : ticket.status;
      const assigned = this.db.run(
        `UPDATE ticket_records SET
           claimed_by_user_id = ?,
           assigned_to_user_id = ?,
           claim_type = 'AUTOMATIC',
           claim_at = ?,
           status = ?,
           last_activity_at = ?,
           updated_at = ?
         WHERE guild_id = ? AND ticket_id = ?
           AND claimed_by_user_id IS NULL AND assigned_to_user_id IS NULL
           AND status NOT IN ('RESOLVED','CLOSED')`,
        [
          timer.first_responder_user_id,
          timer.first_responder_user_id,
          nowIso,
          nextStatus,
          nowIso,
          nowIso,
          timer.guild_id,
          timer.ticket_id,
        ],
      );
      if (assigned.changes !== 1) {
        this.db.run(
          `UPDATE ticket_claim_timers SET status = 'CANCELLED', cancel_reason = 'TICKET_NO_LONGER_ELIGIBLE',
             updated_at = ? WHERE timer_id = ? AND status = 'PENDING'`,
          [nowIso, timerId],
        );
        return 'cancelled' as const;
      }

      // Concurrency guard: only one executor can move PENDING -> EXECUTED.
      const claimed = this.db.run(
        `UPDATE ticket_claim_timers SET status = 'EXECUTED', executed_at = ?, attempts = attempts + 1,
           updated_at = ? WHERE timer_id = ? AND status = 'PENDING'`,
        [nowIso, nowIso, timerId],
      );
      if (claimed.changes !== 1) {
        throw new Error('Automatic claim timer was already executed by another worker.');
      }

      this.db.run(
        `INSERT INTO ticket_assignments (
          ticket_id, guild_id, staff_user_id, assignment_type, assigned_by, assigned_at,
          is_current, completed_meaningful_work
        ) VALUES (?, ?, ?, 'CLAIMED', 'AUTOMATIC', ?, 1, 1)`,
        [timer.ticket_id, timer.guild_id, timer.first_responder_user_id, nowIso],
      );

      this.db.run(
        `INSERT INTO ticket_events (
          ticket_id, guild_id, actor_user_id, event_type, source_event_id, details_json, occurred_at
        ) VALUES (?, ?, ?, 'CLAIMED', ?, ?, ?)`,
        [
          timer.ticket_id,
          timer.guild_id,
          timer.first_responder_user_id,
          `auto:${timerId}`,
          JSON.stringify({
            claimType: 'AUTOMATIC',
            firstResponderUserId: timer.first_responder_user_id,
            delayMinutes: this.getDelayMinutes(),
            timerId,
          }),
          nowIso,
        ],
      );

      this.tickets.recomputeStaffTicketMetrics(timer.guild_id, timer.first_responder_user_id);

      this.audit.log({
        guildId: timer.guild_id,
        actorUserId: 'SYSTEM',
        actionCategory: 'TICKET',
        actionType: 'AUTO_CLAIM_EXECUTED',
        targetType: 'TICKET',
        targetId: timer.ticket_id,
        metadata: {
          firstResponderUserId: timer.first_responder_user_id,
          delayMinutes: this.getDelayMinutes(),
          timerId,
        },
      });

      this.eventBus.publish({
        type: 'ticket.auto_claimed',
        guildId: timer.guild_id,
        ticketId: timer.ticket_id,
        at: nowIso,
        data: { firstResponderUserId: timer.first_responder_user_id, claimType: 'AUTOMATIC' },
      });
      this.eventBus.publish({
        type: 'ticket.updated',
        guildId: timer.guild_id,
        ticketId: timer.ticket_id,
        at: nowIso,
        data: { action: 'auto_claimed', staffUserId: timer.first_responder_user_id },
      });

      return 'executed' as const;
    });
  }

  private ineligibilityReason(timer: TicketClaimTimerRecord, ticket: TicketRecord): string | null {
    if (this.isTicketOwned(ticket)) return 'TICKET_ALREADY_MANUALLY_CLAIMED';
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED' || ticket.resolved_at || ticket.closed_at) {
      return 'TICKET_FINALIZED';
    }
    if (ticket.status !== 'OPEN' && ticket.status !== 'IN_PROGRESS') return 'TICKET_STATUS_INELIGIBLE';
    if (!this.roster.isActiveStaffMember(timer.guild_id, timer.first_responder_user_id)) {
      return 'FIRST_RESPONDER_NO_LONGER_STAFF';
    }
    if (!ticket.first_staff_response_at || ticket.first_response_staff_id !== timer.first_responder_user_id) {
      return 'FIRST_RESPONDER_MISMATCH';
    }
    return null;
  }

  private isTicketOwned(ticket: TicketRecord): boolean {
    return Boolean(ticket.claimed_by_user_id || ticket.assigned_to_user_id);
  }
}
