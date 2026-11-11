import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { PlatformContainer } from '../container';
import { ServerManagementDashboard, ServerDashboardSection, SERVER_DASHBOARD_SECTIONS } from '../dashboards/ServerManagementDashboard';
import { buildActorGuildContextFromDiscord } from '../utils/discordContext';
import { SlashCommandModule } from './types';

export const dashboardCommand: SlashCommandModule = {
  name: 'dashboard',
  data: new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Open the interactive Server Owner & Management Dashboard')
    .addStringOption((opt) =>
      opt
        .setName('section')
        .setDescription('Optional initial dashboard section')
        .addChoices(...SERVER_DASHBOARD_SECTIONS.map((s) => ({ name: s.toUpperCase(), value: s }))),
    ),

  async execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void> {
    if (!interaction.guild) {
      throw new Error('The Server Management Dashboard must be opened inside a Discord server.');
    }

    const ctx = buildActorGuildContextFromDiscord(
      interaction.user,
      interaction.guild,
      interaction.member as never,
      container,
    );
    const section = (interaction.options.getString('section', false) as ServerDashboardSection | null) ?? 'overview';

    const dashboard = new ServerManagementDashboard(container);
    const payload = dashboard.render(ctx, section, 0);
    await interaction.reply({
      embeds: payload.embeds,
      components: payload.components,
      files: payload.files,
      flags: MessageFlags.Ephemeral,
    });
  },
};
