import { EventEmitter } from 'node:events';

export interface PlatformEvent {
  id: string;
  type: string;
  guildId: string | null;
  ticketId?: string;
  at: string;
  data?: Record<string, unknown>;
}

/**
 * In-process pub/sub used by the website SSE bridge. Subscriptions are always
 * filtered by the guild permissions checked by the HTTP layer before subscribing.
 */
export class PlatformEventBus {
  private readonly emitter = new EventEmitter();
  private sequence = 0;

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  public publish(event: Omit<PlatformEvent, 'id'>): PlatformEvent {
    this.sequence += 1;
    const full: PlatformEvent = { ...event, id: `evt_${Date.now()}_${this.sequence}` };
    this.emitter.emit('event', full);
    return full;
  }

  public subscribe(listener: (event: PlatformEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  public get listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}
