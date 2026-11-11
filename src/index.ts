import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { BRANDING } from './config/branding';
import { loadAppConfig } from './config/env';
import { createPlatformContainer } from './container';
import { bindGatewayEvents } from './events/gatewayEvents';
import { logger } from './utils/logger';

export function buildGatewayIntents(config: ReturnType<typeof loadAppConfig>): GatewayIntentBits[] {
  const intents: GatewayIntentBits[] = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.DirectMessages,
  ];

  if (config.enableGuildMembersIntent) {
    intents.push(GatewayIntentBits.GuildMembers);
  }
  if (config.enablePresenceIntent) {
    intents.push(GatewayIntentBits.GuildPresences);
  }
  if (config.enableMessageContentIntent) {
    intents.push(GatewayIntentBits.MessageContent);
  }

  return intents;
}

export async function startPlatform(): Promise<void> {
  const config = loadAppConfig();
  if (!config.discordToken || config.discordToken === 'your_discord_bot_token_here') {
    logger.error(
      'DISCORD_TOKEN is not configured. Run `npm run setup` or copy `.env.example` to `.env` and set DISCORD_TOKEN and DISCORD_CLIENT_ID.',
    );
    process.exit(1);
  }

  const container = createPlatformContainer(config);
  const client = new Client({
    intents: buildGatewayIntents(config),
    partials: [Partials.Channel, Partials.Message],
  });

  bindGatewayEvents(client, container);

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, `Gracefully shutting down ${BRANDING.projectName}...`);
    try {
      container.scheduler.stop();
      await client.destroy();
      container.shutdown();
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));

  logger.info(
    {
      project: BRANDING.projectName,
      creator: BRANDING.creatorIdentity,
      globalOwnerId: BRANDING.globalOwnerId,
      databasePath: config.databasePath,
      guildMembersIntent: config.enableGuildMembersIntent,
      presenceIntent: config.enablePresenceIntent,
      messageContentIntent: config.enableMessageContentIntent,
    },
    'Starting TANVEER STAFF MONITOR',
  );

  await client.login(config.discordToken);
}

if (require.main === module) {
  void startPlatform().catch((err) => {
    logger.fatal({ err }, 'Fatal startup failure in TANVEER STAFF MONITOR');
    process.exit(1);
  });
}
