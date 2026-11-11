import { registerDiscordSlashCommands } from '../src/commands';
import { loadAppConfig } from '../src/config/env';

async function main(): Promise<void> {
  const config = loadAppConfig();
  if (!config.discordToken || !config.discordClientId) {
    throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID must be configured in .env before registering commands.');
  }

  const res = await registerDiscordSlashCommands({
    token: config.discordToken,
    clientId: config.discordClientId,
    devGuildId: config.discordDevGuildId,
  });

  console.log(
    `[TANVEER STAFF MONITOR] Successfully registered ${res.count} root slash command groups (${res.scope} scope).`,
  );
}

void main().catch((err) => {
  console.error('[COMMAND REGISTRATION ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
