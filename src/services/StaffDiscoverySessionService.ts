import { StaffRoleCategory } from '../types/domain';
import { generateEntityId } from '../utils/ids';

export interface StaffDiscoverySession {
  id: string;
  guildId: string;
  actorUserId: string;
  category: StaffRoleCategory;
  page: number;
  selected: Map<string, string>;
  createdAt: number;
}

const SESSION_TTL_MS = 20 * 60_000;

/**
 * Holds in-progress multi-page role selection state for /staff add.
 * Role IDs (never names) are the durable identifiers.
 */
export class StaffDiscoverySessionService {
  private readonly sessions = new Map<string, StaffDiscoverySession>();

  public create(guildId: string, actorUserId: string, category: StaffRoleCategory = 'STAFF'): StaffDiscoverySession {
    this.prune();
    const session: StaffDiscoverySession = {
      id: generateEntityId('SDS'),
      guildId,
      actorUserId,
      category,
      page: 0,
      selected: new Map(),
      createdAt: Date.now(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  public get(id: string): StaffDiscoverySession | undefined {
    this.prune();
    return this.sessions.get(id);
  }

  public setPage(id: string, page: number): StaffDiscoverySession | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    session.page = Math.max(0, page);
    return session;
  }

  public setPageSelection(
    id: string,
    pageRoleIds: readonly string[],
    selectedRoleIds: readonly string[],
  ): StaffDiscoverySession | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    for (const roleId of pageRoleIds) session.selected.delete(roleId);
    for (const roleId of selectedRoleIds) session.selected.set(roleId, roleId);
    return session;
  }

  public clear(id: string): StaffDiscoverySession | undefined {
    const session = this.get(id);
    if (!session) return undefined;
    session.selected.clear();
    return session;
  }

  public delete(id: string): void {
    this.sessions.delete(id);
  }

  public prune(now = Date.now()): void {
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > SESSION_TTL_MS) this.sessions.delete(id);
    }
  }
}
