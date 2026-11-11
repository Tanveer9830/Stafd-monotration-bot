import { ITicketAdapter } from './ITicketAdapter';
import { CustomPatternTicketAdapter } from './adapters/CustomPatternTicketAdapter';
import { GenericTicketAdapter } from './adapters/GenericTicketAdapter';
import { TicketToolAdapter } from './adapters/TicketToolAdapter';
import { TicketsV2Adapter } from './adapters/TicketsV2Adapter';

export class TicketAdapterRegistry {
  private readonly adapters = new Map<string, ITicketAdapter>();
  private readonly fallback = new GenericTicketAdapter();

  constructor() {
    this.register(this.fallback);
    this.register(new TicketToolAdapter());
    this.register(new TicketsV2Adapter());
    this.register(new CustomPatternTicketAdapter());
  }

  public register(adapter: ITicketAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  public get(adapterId: string): { adapter: ITicketAdapter; isSupported: boolean; warning?: string } {
    const found = this.adapters.get(adapterId);
    if (found) {
      return { adapter: found, isSupported: true };
    }
    return {
      adapter: this.fallback,
      isSupported: false,
      warning: `Adapter "${adapterId}" is not natively registered; safely falling back to Generic Discord Ticket Engine.`,
    };
  }

  public listAll(): ITicketAdapter[] {
    return Array.from(this.adapters.values());
  }
}
