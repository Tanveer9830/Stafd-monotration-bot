import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  MessageFlags,
} from 'discord.js';
import { PlatformContainer } from '../../container';
import { GuildAccess } from '../../services/AuthzService';
import { GlobalScope, LocalScope } from '../../types/access';
import { createBrandEmbed } from '../../utils/embeds';

export function requireGuild(interaction: ChatInputCommandInteraction): Guild {
  if (!interaction.guild) {
    throw new Error('This command must be executed inside a Discord server.');
  }
  return interaction.guild;
}

export function registerGuild(interaction: ChatInputCommandInteraction, container: PlatformContainer): Guild {
  const guild = requireGuild(interaction);
  container.guildConfig.ensureGuildRegistered(guild.id, guild.name, guild.ownerId);
  return guild;
}

export async function resolveAccess(
  interaction: ChatInputCommandInteraction,
  container: PlatformContainer,
): Promise<GuildAccess> {
  const guild = registerGuild(interaction, container);
  return container.authz.resolveGuildAccess(interaction.user.id, guild.id);
}

export async function assertLocal(
  interaction: ChatInputCommandInteraction,
  container: PlatformContainer,
  scope: LocalScope,
  action: string,
): Promise<GuildAccess> {
  const access = await resolveAccess(interaction, container);
  container.authz.assertLocalScope(access, scope, action);
  return access;
}

export function assertGlobal(
  interaction: ChatInputCommandInteraction,
  container: PlatformContainer,
  scope: GlobalScope | null,
  action: string,
): void {
  if (scope === null) {
    if (!container.authz.isGlobalOwner(interaction.user.id)) {
      container.audit.log({
        guildId: interaction.guildId ?? null,
        actorUserId: interaction.user.id,
        actionCategory: 'UNAUTHORIZED_ATTEMPT',
        actionType: 'GLOBAL_OWNER_COMMAND_DENIED',
        metadata: { action },
      });
      throw new Error('Access Denied: this operation is reserved for the Permanent Global Owner.');
    }
    return;
  }
  container.authz.assertGlobalScope(interaction.user.id, scope, action);
}

export async function reply(interaction: ChatInputCommandInteraction, embed: EmbedBuilder): Promise<void> {
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function replyWith(
  interaction: ChatInputCommandInteraction,
  embed: EmbedBuilder,
  components?: unknown[],
): Promise<void> {
  await interaction.reply({
    embeds: [embed],
    components: components as never,
    flags: MessageFlags.Ephemeral,
  });
}

export function brand(
  title: string,
  description?: string,
  tone: 'primary' | 'purple' | 'cyan' | 'success' | 'warning' | 'danger' | 'midnight' | 'neutral' = 'primary',
  subtitle?: string,
): EmbedBuilder {
  return createBrandEmbed({ title, description, tone, subtitle });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function statusIcon(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: '🟢',
    AT_RISK: '🟡',
    INACTIVE: '🔴',
    ON_LEAVE: '🔵',
    UNKNOWN: '⚪',
    NEW_STAFF: '🆕',
    INSUFFICIENT_WORKLOAD: '🟠',
    MONITORING_ERROR: '🚨',
  };
  return map[status] ?? '⚪';
}

export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) return '—';
  return `${hours.toFixed(1)}h`;
}

export function truncate(value: string, max = 90): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function chunkLines(lines: string[], max = 20): string {
  return lines.slice(0, max).join('\n');
}

export function parseDateOption(value: string | null | undefined, endOfDay = false): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return `${trimmed}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
}

export function escapeMarkdown(input: string): string {
  return input.replace(/[\\`*_{}[\]()#+\-.!|]/g, '\\$&');
}
