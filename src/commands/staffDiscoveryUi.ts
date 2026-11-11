import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Guild,
  MessageFlags,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextChannel,
} from 'discord.js';
import { PlatformContainer } from '../container';
import { DiscoveryReport } from '../services/StaffDiscoveryService';
import { StaffDiscoverySession } from '../services/StaffDiscoverySessionService';
import { createBrandEmbed } from '../utils/embeds';

const PAGE_SIZE = 20;

export interface DiscoveryRoleView {
  id: string;
  name: string;
  position: number;
  managed: boolean;
}

export function listSelectableRoles(guild: Guild): DiscoveryRoleView[] {
  const roles = guild.roles?.cache ? [...guild.roles.cache.values()] : [];
  return roles
    .filter((role) => role.id !== guild.id && !role.managed)
    .map((role) => ({ id: role.id, name: role.name, position: role.position, managed: Boolean(role.managed) }))
    .sort((a, b) => b.position - a.position);
}

export function buildStaffDiscoveryPayload(
  guild: Guild,
  session: StaffDiscoverySession,
): { embeds: ReturnType<typeof createBrandEmbed>[]; components: unknown[] } {
  const roles = listSelectableRoles(guild);
  const totalPages = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const page = Math.min(Math.max(session.page, 0), totalPages - 1);
  const pageRoles = roles.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  if (roles.length === 0) {
    const embed = createBrandEmbed({
      title: '⚠️ No Selectable Roles',
      description: 'No assignable Discord roles were found in this server. Create staff roles in Discord, then run `/staff add` again.',
      tone: 'warning',
    });
    return { embeds: [embed], components: [] };
  }

  const selectedNames = [...session.selected.keys()]
    .map((id) => roles.find((r) => r.id === id)?.name ?? id)
    .sort();

  const embed = createBrandEmbed({
    title: `🛰️ Staff Role Discovery — Page ${page + 1}/${totalPages}`,
    subtitle: guild.name,
    tone: 'cyan',
    description: [
      '**Step 1 of 2 — Select staff roles**',
      'Choose every role that identifies a staff member. Selections are preserved when you change pages.',
      '',
      `**Roles in server:** ${roles.length}`,
      `**Selected:** ${session.selected.size}`,
      selectedNames.length
        ? `**Selected roles:** ${selectedNames.slice(0, 20).join(', ')}${selectedNames.length > 20 ? ` +${selectedNames.length - 20} more` : ''}`
        : '**Selected roles:** none yet',
      '',
      `Role IDs are stored as permanent identifiers. Category on registration: \`${session.category}\`.`,
    ].join('\n'),
  });

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`tsm:sd:sel:${session.id}`)
    .setPlaceholder('Select staff roles on this page')
    .setMinValues(0)
    .setMaxValues(Math.min(25, Math.max(1, pageRoles.length)))
    .addOptions(
      pageRoles.map((role) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(role.name.slice(0, 100))
          .setValue(role.id)
          .setDescription(`Role ID ${role.id}`)
          .setDefault(session.selected.has(role.id)),
      ),
    );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tsm:sd:page:${session.id}:${page - 1}`)
      .setLabel('◀ Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`tsm:sd:page:${session.id}:${page + 1}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId(`tsm:sd:clear:${session.id}`)
      .setLabel('Clear selections')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tsm:sd:review:${session.id}`)
      .setLabel(`Review (${session.selected.size})`)
      .setStyle(ButtonStyle.Primary),
  );

  const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tsm:sd:confirm:${session.id}`)
      .setLabel('Confirm & Scan')
      .setStyle(ButtonStyle.Success)
      .setDisabled(session.selected.size === 0),
    new ButtonBuilder()
      .setCustomId(`tsm:sd:cancel:${session.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
      buttons,
      confirmRow,
    ],
  };
}

export function buildDiscoveryReview(
  guild: Guild,
  session: StaffDiscoverySession,
): { embeds: ReturnType<typeof createBrandEmbed>[]; components: unknown[] } {
  const roles = listSelectableRoles(guild);
  const selected = [...session.selected.keys()].map((id) => ({
    id,
    name: roles.find((r) => r.id === id)?.name ?? id,
  }));
  const embed = createBrandEmbed({
    title: '🛰️ Review Staff Role Selection',
    subtitle: guild.name,
    tone: 'purple',
    description: [
      '**Step 2 of 2 — Review & confirm**',
      `Selected **${selected.length}** role(s). The bot will fetch the member roster and register every member holding at least one of these roles.`,
      '',
      selected.length ? selected.map((r) => `• **${r.name}** (\`${r.id}\`)`).join('\n') : 'No roles selected.',
      '',
      'Members are deduplicated by guild + user ID. Existing profiles and history are preserved.',
    ].join('\n'),
  });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`tsm:sd:page:${session.id}:${session.page}`)
      .setLabel('← Back to selection')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`tsm:sd:confirm:${session.id}`)
      .setLabel('Confirm & Scan')
      .setStyle(ButtonStyle.Success)
      .setDisabled(selected.length === 0),
    new ButtonBuilder()
      .setCustomId(`tsm:sd:cancel:${session.id}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row] };
}

export async function confirmStaffDiscovery(
  guild: Guild,
  session: StaffDiscoverySession,
  container: PlatformContainer,
  actorUserId: string,
): Promise<DiscoveryReport> {
  const roles = listSelectableRoles(guild);
  const selected = [...session.selected.keys()].map((id) => ({
    roleId: id,
    roleName: roles.find((r) => r.id === id)?.name ?? id,
  }));
  if (selected.length === 0) throw new Error('Select at least one staff role before confirming.');

  let members = guild.members?.cache;
  let coverageLevel: 'FULL' | 'PARTIAL' | 'UNAVAILABLE' = 'PARTIAL';
  let fetchWarning: string | null = null;

  if (!container.config.enableGuildMembersIntent) {
    fetchWarning =
      'ENABLE_GUILD_MEMBERS_INTENT is disabled. Only cached members were scanned. Enable the Guild Members privileged intent in the Discord Developer Portal and set ENABLE_GUILD_MEMBERS_INTENT=true for complete coverage.';
  } else {
    try {
      members = await guild.members.fetch();
      coverageLevel = 'FULL';
    } catch (err) {
      coverageLevel = 'PARTIAL';
      fetchWarning = `Full member fetch failed (${err instanceof Error ? err.message : String(err)}). Cached members were scanned. Verify the Guild Members intent and bot permissions.`;
    }
  }

  const snapshots = members
    ? [...members.values()].map((member) => ({
        userId: member.id,
        username: member.user?.username ?? member.id,
        displayName: member.displayName ?? member.user?.username ?? member.id,
        roleIds: [...member.roles.cache.keys()],
        presenceStatus: member.presence?.status ?? null,
        isBot: Boolean(member.user?.bot),
      }))
    : [];

  if (snapshots.length === 0) coverageLevel = 'UNAVAILABLE';

  container.staffDiscovery.registerSelectedRoles(guild.id, actorUserId, selected, session.category);
  return container.staffDiscovery.discoverMembers(guild.id, actorUserId, selected, snapshots, {
    coverageLevel,
    fetchWarning,
  });
}

export function buildDiscoveryReportEmbed(guildName: string, report: DiscoveryReport): ReturnType<typeof createBrandEmbed> {
  const embed = createBrandEmbed({
    title: '✅ Staff Discovery Scan Complete',
    subtitle: guildName,
    tone: report.errors.length ? 'warning' : 'success',
    description: [
      `**Scan ID:** \`${report.scanId}\``,
      `**Coverage:** \`${report.coverageLevel}\``,
      '',
      `**Roles selected:** ${report.rolesSelected.length}`,
      `**Members scanned:** ${report.membersScanned}`,
      `**Staff discovered:** ${report.staffDiscovered}`,
      `**Newly registered:** ${report.newlyRegistered}`,
      `**Existing profiles updated:** ${report.existingProfiles}`,
      `**Members with multiple selected roles:** ${report.multiRoleMembers}`,
      report.unmatchedRoles.length ? `**Unmatched role IDs:** ${report.unmatchedRoles.join(', ')}` : '',
      report.errors.length ? `\n⚠️ **Warnings / errors:**\n${report.errors.map((e) => `• ${e}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  });
  return embed;
}
