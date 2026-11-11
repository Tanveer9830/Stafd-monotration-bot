import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { emojis } from '../config/emojis';
import { createBrandEmbed } from '../utils/embeds';
import { SlashCommandModule } from './types';
import { GLOBAL_OWNER_ID } from '../config/branding';

export const helpCommand: SlashCommandModule = {
  name: 'help',
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Interactive command guide and permission reference')
    .addStringOption((opt) =>
      opt
        .setName('category')
        .setDescription('Command category to view')
        .setRequired(false)
        .addChoices(
          { name: 'Owner / Administration', value: 'owner' },
          { name: 'Server Management', value: 'server' },
          { name: 'Staff Management', value: 'staff' },
          { name: 'Activity Tracking', value: 'activity' },
          { name: 'Monitoring Controls', value: 'monitor' },
          { name: 'Roster Scanning', value: 'scan' },
          { name: 'Ticket Management', value: 'ticket' },
          { name: 'Integrations', value: 'integration' },
          { name: 'Inactivity Review', value: 'review' },
          { name: 'Warnings', value: 'warning' },
          { name: 'Appeals', value: 'appeal' },
          { name: 'Leave Management', value: 'leave' },
          { name: 'Analytics', value: 'analytics' },
          { name: 'Reports', value: 'report' },
          { name: 'Settings', value: 'settings' },
          { name: 'Security', value: 'security' },
          { name: 'Audit Logs', value: 'logs' },
          { name: 'Backups', value: 'backup' },
          { name: 'System Health', value: 'system' },
          { name: 'Notifications', value: 'notification' },
          { name: 'All Commands', value: 'all' },
        ),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    const actorId = interaction.user.id;
    const category = interaction.options.getString('category', false) ?? 'all';

    const allCommands: Array<{ name: string; description: string; permission: string }> = [
      { name: '/owner', description: 'Global Owner management & cross-server telemetry', permission: 'Global Owner only' },
      { name: '/admin', description: 'Bot administrator management', permission: 'Global Owner only' },
      { name: '/server', description: 'Server management operations', permission: 'Server Owner or Global Owner' },
      { name: '/dashboard', description: 'Interactive dashboards', permission: 'Server Owner or Global Owner' },
      { name: '/staff', description: 'Staff management & monitoring', permission: 'Server Owner or authorized reviewer' },
      { name: '/activity', description: 'Staff activity tracking', permission: 'View reports or owner' },
      { name: '/monitor', description: 'Monitoring controls', permission: 'Server Owner or Global Owner' },
      { name: '/scan', description: 'Manual and scheduled scans', permission: 'Server Owner or Global Owner' },
      { name: '/ticket', description: 'Ticket management', permission: 'Server Owner or authorized' },
      { name: '/integration', description: 'Ticket integrations', permission: 'Server Owner or Global Owner' },
      { name: '/review', description: 'Inactivity warning review', permission: 'Authorized reviewer or owner' },
      { name: '/warning', description: 'Warning management', permission: 'Authorized reviewer or owner' },
      { name: '/appeal', description: 'Warning appeals', permission: 'Staff (submit) / Reviewer (decide)' },
      { name: '/leave', description: 'Staff leave management', permission: 'Staff (submit) / Manager (approve)' },
      { name: '/analytics', description: 'Performance analytics', permission: 'View reports or owner' },
      { name: '/report', description: 'Report generation', permission: 'View reports or owner' },
      { name: '/settings', description: 'Server configuration', permission: 'Server Owner or Global Owner' },
      { name: '/security', description: 'Security and permissions', permission: 'Server Owner or Global Owner' },
      { name: '/logs', description: 'Audit logs', permission: 'View reports or owner' },
      { name: '/backup', description: 'Database backup & recovery', permission: 'Global Owner only' },
      { name: '/system', description: 'Bot health & diagnostics', permission: 'Server Owner or Global Owner' },
      { name: '/notification', description: 'Notification management', permission: 'Server Owner or Global Owner' },
      { name: '/help', description: 'Interactive command guide', permission: 'All users' },
    ];

    let filtered = allCommands;
    if (category !== 'all') {
      const catMap: Record<string, string[]> = {
        owner: ['/owner', '/admin'],
        server: ['/server', '/dashboard'],
        staff: ['/staff', '/activity'],
        monitor: ['/monitor', '/scan'],
        ticket: ['/ticket', '/integration'],
        review: ['/review', '/warning'],
        appeal: ['/appeal'],
        leave: ['/leave'],
        analytics: ['/analytics', '/report'],
        settings: ['/settings'],
        security: ['/security', '/logs'],
        backup: ['/backup'],
        system: ['/system'],
        notification: ['/notification'],
      };
      const catCmds = catMap[category] ?? [];
      filtered = allCommands.filter((c) => catCmds.includes(c.name));
    }

    const embed = createBrandEmbed({
      title: `${emojis.get('performance')} TANVEER STAFF MONITOR — Command Guide`,
      tone: 'primary',
      subtitle: category === 'all' ? 'All 23 Command Roots' : category,
      description:
        `**Permanent Global Owner:** \`${GLOBAL_OWNER_ID}\`\n\n` +
        `Select a category from the dropdown below, or view all commands.\n\n` +
        `**Security Rule:** Administrative commands are executable ONLY by the actual Discord Server Owner or the Permanent Global Owner.\n` +
        `Co-Owners, Administrators, Moderators, Staff, and members with Discord Administrator permission are explicitly excluded.`,
    }).addFields(
      filtered.map((c) => ({
        name: c.name,
        value: `${c.description}\n*Permission: ${c.permission}*`,
        inline: true,
      })),
    );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    return;
  },
};
