import { Guild, GuildMember, PermissionsBitField } from 'discord.js';
import { PlatformContainer } from '../container';
import { ActorGuildContext } from '../services/PermissionService';
import { GuildMemberSnapshot } from '../services/RosterService';
import { ChannelPermissionCheck } from '../tickets/ITicketAdapter';

export function buildActorGuildContextFromDiscord(
  user: { id: string; tag?: string; username?: string },
  guild: Guild,
  member: GuildMember | { roles?: unknown } | null,
  container: PlatformContainer,
): ActorGuildContext {
  container.guildConfig.ensureGuildRegistered(guild.id, guild.name, guild.ownerId);

  let roleIds: string[] = [];
  if (member && 'roles' in member && member.roles) {
    const rolesObj = member.roles as { cache?: Map<string, { id: string }> } | string[];
    if (Array.isArray(rolesObj)) {
      roleIds = rolesObj;
    } else if (rolesObj.cache) {
      roleIds = Array.from(rolesObj.cache.keys());
    }
  }

  return {
    userId: user.id,
    userTag: user.tag ?? user.username ?? user.id,
    guildId: guild.id,
    actualGuildOwnerId: guild.ownerId,
    memberRoleIds: roleIds,
  };
}

export async function collectLiveGuildTelemetry(
  guild: Guild,
  container: PlatformContainer,
): Promise<{
  liveMembers: GuildMemberSnapshot[];
  roleHoldersMap: Map<string, string[]>;
  livePermissionChecks: ChannelPermissionCheck[];
}> {
  let membersCollection = guild.members.cache;
  try {
    if (container.config.enableGuildMembersIntent) {
      membersCollection = await guild.members.fetch();
    }
  } catch {
    membersCollection = guild.members.cache;
  }

  const liveMembers: GuildMemberSnapshot[] = [];
  const roleHoldersMap = new Map<string, string[]>();

  for (const [, member] of membersCollection) {
    if (member.user.bot) continue;
    const roleIds = Array.from(member.roles.cache.keys());
    liveMembers.push({
      userId: member.id,
      username: member.user.username,
      displayName: member.displayName || member.user.username,
      roleIds,
      presenceStatus: member.presence?.status ?? null,
      isBot: false,
    });
    for (const rid of roleIds) {
      const arr = roleHoldersMap.get(rid) ?? [];
      arr.push(member.id);
      roleHoldersMap.set(rid, arr);
    }
  }

  const configs = container.tickets.listTicketChannelConfigs(guild.id);
  const me = guild.members.me;
  const livePermissionChecks: ChannelPermissionCheck[] = configs.map((cfg) => {
    const ch = guild.channels.cache.get(cfg.channel_id);
    if (!ch) {
      return {
        channelId: cfg.channel_id,
        channelName: cfg.channel_name,
        targetType: cfg.target_type,
        exists: false,
        canViewChannel: false,
        canReadHistory: false,
        canSendMessages: false,
      };
    }

    if (!me) {
      return {
        channelId: cfg.channel_id,
        channelName: ch.name,
        targetType: cfg.target_type,
        exists: true,
        canViewChannel: true,
        canReadHistory: true,
        canSendMessages: true,
      };
    }

    const perms = ch.permissionsFor(me);
    return {
      channelId: cfg.channel_id,
      channelName: ch.name,
      targetType: cfg.target_type,
      exists: true,
      canViewChannel: Boolean(perms?.has(PermissionsBitField.Flags.ViewChannel)),
      canReadHistory: Boolean(perms?.has(PermissionsBitField.Flags.ReadMessageHistory)),
      canSendMessages: Boolean(perms?.has(PermissionsBitField.Flags.SendMessages)),
    };
  });

  return {
    liveMembers,
    roleHoldersMap,
    livePermissionChecks,
  };
}
