import { REST, Routes } from 'discord.js';
import { activityCommand } from './activityCommand';
import { adminCommand } from './adminCommand';
import { analyticsCommand } from './analyticsCommand';
import { appealCommand } from './appealCommand';
import { backupCommand } from './backupCommand';
import { dashboardCommand } from './dashboardCommand';
import { helpCommand } from './helpCommand';
import { integrationCommand } from './integrationCommand';
import { leaveCommand } from './leaveCommand';
import { logsCommand } from './logsCommand';
import { monitorCommand } from './monitorCommand';
import { notificationCommand } from './notificationCommand';
import { ownerCommand } from './ownerCommand';
import { reportCommand } from './reportCommand';
import { reviewCommand } from './reviewCommand';
import { scanCommand } from './scanCommand';
import { securityCommand } from './securityCommand';
import { serverCommand } from './serverCommand';
import { settingsCommand } from './settingsCommand';
import { staffCommand } from './staffCommand';
import { systemCommand } from './systemCommand';
import { ticketCommand } from './ticketCommand';
import { warningCommand } from './warningCommand';
import { SlashCommandModule } from './types';

export const ALL_COMMANDS: readonly SlashCommandModule[] = [
  ownerCommand,
  adminCommand,
  serverCommand,
  dashboardCommand,
  staffCommand,
  activityCommand,
  monitorCommand,
  scanCommand,
  ticketCommand,
  integrationCommand,
  reviewCommand,
  warningCommand,
  appealCommand,
  leaveCommand,
  analyticsCommand,
  reportCommand,
  settingsCommand,
  securityCommand,
  logsCommand,
  backupCommand,
  systemCommand,
  notificationCommand,
  helpCommand,
];

export const COMMAND_MAP = new Map<string, SlashCommandModule>(
  ALL_COMMANDS.map((c) => [c.name, c]),
);

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
