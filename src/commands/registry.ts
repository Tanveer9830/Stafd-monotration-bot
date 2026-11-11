import {
  ChatInputCommandInteraction,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js';
import { PlatformContainer } from '../container';
import { CommandContext, CommandModule, CommandOperation, operationKey } from './ops/types';
import { OWNER_OPERATIONS } from './ops/ownerOps';
import { ADMIN_OPERATIONS } from './ops/adminOps';
import { SERVER_OPERATIONS } from './ops/serverOps';
import { STAFF_OPERATIONS } from './ops/staffOps';
import { ACTIVITY_OPERATIONS } from './ops/activityOps';
import { TICKET_OPERATIONS } from './ops/ticketOps';
import { MONITOR_OPERATIONS } from './ops/monitorOps';
import { SCAN_OPERATIONS } from './ops/scanOps';
import { REVIEW_OPERATIONS } from './ops/reviewOps';
import { WARNING_OPERATIONS } from './ops/warningOps';
import { APPEAL_OPERATIONS } from './ops/appealOps';
import { LEAVE_OPERATIONS } from './ops/leaveOps';
import { ANALYTICS_OPERATIONS } from './ops/analyticsOps';
import { REPORT_OPERATIONS } from './ops/reportOps';
import { INTEGRATION_OPERATIONS } from './ops/integrationOps';
import { SETTINGS_OPERATIONS } from './ops/settingsOps';
import { SYSTEM_OPERATIONS } from './ops/systemOps';
import { HELP_OPERATIONS } from './ops/helpOps';

export const ROOT_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  owner: 'Permanent Global Owner platform administration (cross-server)',
  admin: 'Server-local administrator and website access management',
  server: 'Server setup, status and diagnostics',
  staff: 'Staff discovery, roster, profiles and role configuration',
  activity: 'Live staff activity monitoring',
  ticket: 'Ticket browser, assignment, lifecycle and statistics',
  monitor: 'Monitoring controls and inactivity thresholds',
  scan: 'Run monitoring scans on demand',
  review: 'Inactivity review workflow (human approval required)',
  warning: 'Staff warnings, history and removals',
  appeal: 'Warning appeals',
  leave: 'Approved leave management',
  analytics: 'Staff, ticket and workload analytics',
  report: 'Reports and exports',
  integration: 'Third-party ticket integrations',
  settings: 'Server monitoring configuration',
  system: 'System health and diagnostics',
  help: 'Command reference',
});

export const ALL_OPERATIONS: readonly CommandOperation[] = Object.freeze([
  ...OWNER_OPERATIONS,
  ...ADMIN_OPERATIONS,
  ...SERVER_OPERATIONS,
  ...STAFF_OPERATIONS,
  ...ACTIVITY_OPERATIONS,
  ...TICKET_OPERATIONS,
  ...MONITOR_OPERATIONS,
  ...SCAN_OPERATIONS,
  ...REVIEW_OPERATIONS,
  ...WARNING_OPERATIONS,
  ...APPEAL_OPERATIONS,
  ...LEAVE_OPERATIONS,
  ...ANALYTICS_OPERATIONS,
  ...REPORT_OPERATIONS,
  ...INTEGRATION_OPERATIONS,
  ...SETTINGS_OPERATIONS,
  ...SYSTEM_OPERATIONS,
  ...HELP_OPERATIONS,
]);

export const OPERATION_MAP: ReadonlyMap<string, CommandOperation> = new Map(
  ALL_OPERATIONS.map((op) => [operationKey(op), op]),
);

function applyOptions(builder: unknown, operation: CommandOperation): void {
  // discord.js fluent builder; typed as unknown to support every option kind uniformly.
  const b = builder as {
    addStringOption(fn: (o: unknown) => unknown): unknown;
    addIntegerOption(fn: (o: unknown) => unknown): unknown;
    addBooleanOption(fn: (o: unknown) => unknown): unknown;
    addUserOption(fn: (o: unknown) => unknown): unknown;
    addRoleOption(fn: (o: unknown) => unknown): unknown;
    addNumberOption(fn: (o: unknown) => unknown): unknown;
    addChannelOption(fn: (o: unknown) => unknown): unknown;
  };

  for (const opt of operation.options ?? []) {
    const configure = (o: {
      setName(n: string): typeof o;
      setDescription(d: string): typeof o;
      setRequired(r: boolean): typeof o;
      setMinValue(v: number): typeof o;
      setMaxValue(v: number): typeof o;
      setAutocomplete(v: boolean): typeof o;
      addChoices(...choices: Array<{ name: string; value: string | number }>): typeof o;
      addChannelTypes(...types: number[]): typeof o;
    }) => {
      o.setName(opt.name).setDescription(opt.description.slice(0, 100));
      if (opt.required) o.setRequired(true);
      if (opt.minValue !== undefined && 'setMinValue' in o) o.setMinValue(opt.minValue);
      if (opt.maxValue !== undefined && 'setMaxValue' in o) o.setMaxValue(opt.maxValue);
      if (opt.autocomplete && 'setAutocomplete' in o) o.setAutocomplete(true);
      if (opt.choices && 'addChoices' in o)
        o.addChoices(...opt.choices.map((c) => ({ ...c, name: String(c.name).slice(0, 100) })));
      if (opt.channelTypes && 'addChannelTypes' in o) o.addChannelTypes(...opt.channelTypes);
      return o;
    };

    switch (opt.kind) {
      case 'string':
        b.addStringOption((o) => configure(o as never) as never);
        break;
      case 'integer':
        b.addIntegerOption((o) => configure(o as never) as never);
        break;
      case 'number':
        b.addNumberOption((o) => configure(o as never) as never);
        break;
      case 'boolean':
        b.addBooleanOption((o) => configure(o as never) as never);
        break;
      case 'user':
        b.addUserOption((o) => configure(o as never) as never);
        break;
      case 'role':
        b.addRoleOption((o) => configure(o as never) as never);
        break;
      case 'channel':
        b.addChannelOption((o) => configure(o as never) as never);
        break;
    }
  }
}

export function buildCommandModules(operations: readonly CommandOperation[] = ALL_OPERATIONS): CommandModule[] {
  const roots = [...new Set(operations.map((o) => o.root))];
  return roots.map((root) => {
    const builder = new SlashCommandBuilder()
      .setName(root)
      .setDescription((ROOT_DESCRIPTIONS[root] ?? 'TANVEER STAFF MONITOR command').slice(0, 100));

    const rootOps = operations.filter((o) => o.root === root);
    const groups = [...new Set(rootOps.filter((o) => o.group).map((o) => o.group!))];

    for (const group of groups) {
      const groupOps = rootOps.filter((o) => o.group === group);
      builder.addSubcommandGroup((g) => {
        g.setName(group).setDescription(`${group.charAt(0).toUpperCase()}${group.slice(1)} operations`.slice(0, 100));
        for (const op of groupOps) {
          g.addSubcommand((sub) => {
            sub.setName(op.sub).setDescription(op.description.slice(0, 100));
            applyOptions(sub, op);
            return sub;
          });
        }
        return g;
      });
    }

    for (const op of rootOps.filter((o) => !o.group && !o.standalone)) {
      builder.addSubcommand((sub) => {
        sub.setName(op.sub).setDescription(op.description.slice(0, 100));
        applyOptions(sub, op);
        return sub;
      });
    }

    for (const op of rootOps.filter((o) => o.standalone)) {
      applyOptions(builder, op);
    }

    const dispatch = async (
      interaction: ChatInputCommandInteraction,
      container: PlatformContainer,
    ): Promise<void> => {
      const group = interaction.options.getSubcommandGroup(false);
      const sub = rootOps.some((o) => o.standalone)
        ? root
        : interaction.options.getSubcommand(true);
      const standalone = rootOps.some((o) => o.standalone);
      const key = standalone ? root : group ? `${root} ${group} ${sub}` : `${root} ${sub}`;
      const operation = OPERATION_MAP.get(key);
      if (!operation) {
        throw new Error(`Unregistered command operation "${key}". This operation is not part of the approved 100-command scope.`);
      }
      const ctx: CommandContext = {
        interaction,
        container,
        guildId: interaction.guildId ?? null,
        actorId: interaction.user.id,
        operation: key,
      };
      await operation.handler(ctx);
    };

    return {
      name: root,
      data: builder as unknown as CommandModule['data'],
      dispatch,
    };
  });
}

export const ALL_COMMANDS: readonly CommandModule[] = Object.freeze(buildCommandModules());

export const COMMAND_MAP: ReadonlyMap<string, CommandModule> = new Map(
  ALL_COMMANDS.map((c) => [c.name, c]),
);

export function listRegisteredOperations(): string[] {
  return ALL_OPERATIONS.map((op) => operationKey(op));
}

export async function registerDiscordSlashCommands(params: {
  token: string;
  clientId: string;
  devGuildId?: string;
}): Promise<{ count: number; scope: 'guild' | 'global'; operationCount: number }> {
  const rest = new REST({ version: '10' }).setToken(params.token);
  const body = ALL_COMMANDS.map((c) => c.data.toJSON());

  if (params.devGuildId && params.devGuildId.trim().length > 0) {
    await rest.put(Routes.applicationGuildCommands(params.clientId, params.devGuildId.trim()), { body });
    return { count: body.length, scope: 'guild', operationCount: ALL_OPERATIONS.length };
  }

  await rest.put(Routes.applicationCommands(params.clientId), { body });
  return { count: body.length, scope: 'global', operationCount: ALL_OPERATIONS.length };
}
