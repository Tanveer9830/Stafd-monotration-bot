import { GuildConfigService } from '../services/GuildConfigService';
import { IRelationalDatabase } from '../database/connection';
import { RosterService } from '../services/RosterService';

export interface WebMember {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  roles: string[];
  isStaff: boolean;
}

export interface WebRole {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

export interface WebGuildSummary {
  id: string;
  name: string;
  ownerId: string;
  iconUrl: string | null;
  memberCount: number | null;
}

export interface WebDiscordProvider {
  getGuildOwnerId(guildId: string): Promise<string | null>;
  getGuildSummary(guildId: string): Promise<WebGuildSummary | null>;
  listRoles(guildId: string): Promise<WebRole[]>;
  searchMembers(guildId: string, query: string, limit?: number): Promise<WebMember[]>;
  isMemberOfGuild(guildId: string, userId: string): Promise<boolean>;
}

interface MinimalMember {
  id: string;
  displayName?: string | null;
  user?: { username?: string; bot?: boolean; avatar?: string | null; id?: string };
  roles: { cache: Map<string, unknown> };
  avatarURL?: (opts?: unknown) => string | null;
  displayAvatarURL?: (opts?: unknown) => string | null;
}

interface MinimalGuild {
  id: string;
  name: string;
  ownerId: string;
  memberCount?: number;
  iconURL?: (opts?: unknown) => string | null;
  roles: { cache: Map<string, { id: string; name: string; color: number; position: number; managed: boolean }> };
  members: {
    cache: Map<string, MinimalMember>;
    fetch(options?: unknown): Promise<Map<string, MinimalMember>>;
    search?(options: { query: string; limit?: number }): Promise<Map<string, MinimalMember>>;
  };
}

interface MinimalClient {
  guilds: {
    cache: Map<string, MinimalGuild>;
    fetch(guildId: string): Promise<MinimalGuild>;
  };
}

/**
 * Live Discord-backed provider used by the website for ownership revalidation,
 * member search, role listing and guild metadata. Every result comes from Discord
 * (or the bot's verified cache), never from browser input.
 */
export class DiscordJsWebProvider implements WebDiscordProvider {
  private readonly client: MinimalClient;
  private readonly roster: RosterService;

  constructor(client: MinimalClient, roster: RosterService) {
    this.client = client;
    this.roster = roster;
  }

  private async getGuild(guildId: string): Promise<MinimalGuild | null> {
    const cached = this.client.guilds.cache.get(guildId);
    if (cached) return cached;
    try {
      return await this.client.guilds.fetch(guildId);
    } catch {
      return null;
    }
  }

  public async getGuildOwnerId(guildId: string): Promise<string | null> {
    const guild = await this.getGuild(guildId);
    return guild?.ownerId ?? null;
  }

  public async getGuildSummary(guildId: string): Promise<WebGuildSummary | null> {
    const guild = await this.getGuild(guildId);
    if (!guild) return null;
    return {
      id: guild.id,
      name: guild.name,
      ownerId: guild.ownerId,
      iconUrl: guild.iconURL?.({ size: 128 }) ?? null,
      memberCount: guild.memberCount ?? null,
    };
  }

  public async listRoles(guildId: string): Promise<WebRole[]> {
    const guild = await this.getGuild(guildId);
    if (!guild) return [];
    return [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id && !role.managed)
      .map((role) => ({
        id: role.id,
        name: role.name,
        color: role.color,
        position: role.position,
        managed: role.managed,
      }))
      .sort((a, b) => b.position - a.position);
  }

  public async searchMembers(guildId: string, query: string, limit = 25): Promise<WebMember[]> {
    const guild = await this.getGuild(guildId);
    if (!guild) return [];
    const normalized = query.trim().toLowerCase();
    let members: MinimalMember[] = [];

    if (normalized && typeof guild.members.search === 'function') {
      try {
        const found = await guild.members.search({ query: normalized, limit });
        members = [...found.values()];
      } catch {
        members = [];
      }
    }

    if (members.length === 0) {
      members = [...guild.members.cache.values()];
    }

    return members
      .filter((member) => !member.user?.bot)
      .filter((member) => {
        if (!normalized) return true;
        const username = member.user?.username?.toLowerCase() ?? '';
        const display = (member.displayName ?? '').toLowerCase();
        return username.includes(normalized) || display.includes(normalized) || member.id === normalized;
      })
      .slice(0, limit)
      .map((member) => ({
        id: member.id,
        username: member.user?.username ?? member.id,
        displayName: member.displayName ?? member.user?.username ?? member.id,
        avatarUrl: member.displayAvatarURL?.({ size: 64 }) ?? null,
        roles: [...member.roles.cache.keys()],
        isStaff: this.roster.isActiveStaffMember(guildId, member.id),
      }));
  }

  public async isMemberOfGuild(guildId: string, userId: string): Promise<boolean> {
    const guild = await this.getGuild(guildId);
    if (!guild) return false;
    if (guild.members.cache.has(userId)) return true;
    try {
      const member = await (guild.members as unknown as { fetch(id: string): Promise<MinimalMember> }).fetch(userId);
      return Boolean(member);
    } catch {
      return false;
    }
  }
}

/**
 * Database-only fallback used when the bot client is not attached (for example a
 * standalone dashboard process). It exposes only persisted staff records and
 * configured roles — never invented members.
 */
export class DatabaseWebProvider implements WebDiscordProvider {
  private readonly db: IRelationalDatabase;
  private readonly guildConfig: GuildConfigService;
  private readonly roster: RosterService;

  constructor(db: IRelationalDatabase, guildConfig: GuildConfigService, roster: RosterService) {
    this.db = db;
    this.guildConfig = guildConfig;
    this.roster = roster;
  }

  public async getGuildOwnerId(guildId: string): Promise<string | null> {
    return this.guildConfig.getGuildConfig(guildId)?.owner_id ?? null;
  }

  public async getGuildSummary(guildId: string): Promise<WebGuildSummary | null> {
    const cfg = this.guildConfig.getGuildConfig(guildId);
    if (!cfg) return null;
    const staff = this.roster.listStaffProfiles(guildId, { onlyActiveStaff: true });
    return { id: cfg.guild_id, name: cfg.guild_name, ownerId: cfg.owner_id, iconUrl: null, memberCount: staff.length };
  }

  public async listRoles(guildId: string): Promise<WebRole[]> {
    return this.roster
      .listStaffRoles(guildId)
      .map((r, idx) => ({ id: r.role_id, name: r.role_name, color: 0, position: idx, managed: false }));
  }

  public async searchMembers(guildId: string, query: string, limit = 25): Promise<WebMember[]> {
    const normalized = query.trim().toLowerCase();
    return this.roster
      .listStaffProfiles(guildId, { onlyActiveStaff: true })
      .filter((p) => !normalized || p.username.toLowerCase().includes(normalized) || p.display_name.toLowerCase().includes(normalized) || p.user_id === normalized)
      .slice(0, limit)
      .map((p) => ({
        id: p.user_id,
        username: p.username,
        displayName: p.display_name,
        avatarUrl: null,
        roles: JSON.parse(p.active_role_ids_json) as string[],
        isStaff: true,
      }));
  }

  public async isMemberOfGuild(guildId: string, userId: string): Promise<boolean> {
    return Boolean(this.roster.getStaffProfile(guildId, userId));
  }
}
