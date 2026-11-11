import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { PlatformContainer } from '../container';

export interface SlashCommandModule {
  readonly name: string;
  readonly data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder;
  execute(interaction: ChatInputCommandInteraction, container: PlatformContainer): Promise<void>;
}
