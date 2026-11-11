import { REST, Routes } from 'discord.js';
import { dashboardCommand } from './dashboardCommand';
import { ownerCommand } from './ownerCommand';
import { reviewCommand } from './reviewCommand';
import { settingsCommand } from './settingsCommand';
import { staffCommand } from './staffCommand';
import { ticketCommand } from './ticketCommand';
import { SlashCommandModule } from './types';
import { warningCommand } from './warningCommand';

export const ALL_COMMANDS: readonly SlashCommandModule[] = [
  ownerCommand,
  staffCommand,
  ticketCommand,
  reviewCommand,
  warningCommand,
  settingsCommand,
  dashboardCommand,
];

export const COMMAND_MAP = new Map<string, SlashCommandModule>(ALL_COMMANDS.map((c) => [c.name, c]));

export async function registerDiscordSlashCommands(params: {
  token: string;
  clientId: string;
  devGuildId?: string;
}): Promise<{ count: number; scope: 'guild' | 'global' }> {
  const rest = new REST({ version: '10' }).setToken(params.token);
  const body = ALL_COMMANDS.map((c) => c.data.toJSON());

  if (params.devGuildId && params.devGuildId.trim().length > 0) {
    await rest.put(Routes.applicationGuildCommands(params.clientId, params.devGuildId.trim()), { body });
    return { count: body.length, scope: 'guild' };
  }

  await rest.put(Routes.applicationCommands(params.clientId), { body });
  return { count: body.length, scope: 'global' };
}
