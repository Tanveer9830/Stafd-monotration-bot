import {
  ChatInputCommandInteraction,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { PlatformContainer } from '../../container';
import { GuildAccess } from '../../services/AuthzService';

export interface CommandOptionChoice {
  name: string;
  value: string | number;
}

export interface CommandOptionSpec {
  kind: 'string' | 'integer' | 'boolean' | 'user' | 'role' | 'channel' | 'number';
  name: string;
  description: string;
  required?: boolean;
  choices?: CommandOptionChoice[];
  minValue?: number;
  maxValue?: number;
  channelTypes?: number[];
  autocomplete?: boolean;
}

export interface CommandContext {
  interaction: ChatInputCommandInteraction;
  container: PlatformContainer;
  guildId: string | null;
  actorId: string;
  access?: GuildAccess;
  operation: string;
}

export type CommandHandler = (ctx: CommandContext) => Promise<void>;

export interface CommandOperation {
  root: string;
  group?: string;
  sub: string;
  description: string;
  standalone?: boolean;
  options?: CommandOptionSpec[];
  handler: CommandHandler;
}

export interface CommandModule {
  name: string;
  data: SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
  dispatch(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void>;
}

export function operationKey(op: Pick<CommandOperation, 'root' | 'group' | 'sub'> & { standalone?: boolean }): string {
  if (op.standalone) return op.root;
  return [op.root, op.group, op.sub].filter(Boolean).join(' ');
}
