import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppConfig } from '../../src/config/env';
import { GLOBAL_OWNER_ID } from '../../src/config/branding';
import { createPlatformContainer, PlatformContainer } from '../../src/container';
import { IDiscordDeliveryAdapter, OutgoingDiscordPayload } from '../../src/services/NotificationService';

export interface SentMessageRecord {
  targetType: 'DM' | 'CHANNEL';
  targetId: string;
  guildId?: string;
  payload: OutgoingDiscordPayload;
}

export class SpyDiscordDeliveryAdapter implements IDiscordDeliveryAdapter {
  public readonly sent: SentMessageRecord[] = [];
  public readonly failingDmUserIds = new Set<string>();
  public readonly failingChannelIds = new Set<string>();

  public async sendDirectMessage(
    userId: string,
    payload: OutgoingDiscordPayload,
  ): Promise<{ delivered: boolean; error?: string }> {
    if (this.failingDmUserIds.has(userId)) {
      return { delivered: false, error: 'Cannot send messages to this user (DMs disabled)' };
    }
    this.sent.push({ targetType: 'DM', targetId: userId, payload });
    return { delivered: true };
  }

  public async sendGuildChannelMessage(
    guildId: string,
    channelId: string,
    payload: OutgoingDiscordPayload,
  ): Promise<{ delivered: boolean; error?: string }> {
    if (this.failingChannelIds.has(channelId)) {
      return { delivered: false, error: 'Missing SendMessages permission in fallback channel' };
    }
    this.sent.push({ targetType: 'CHANNEL', targetId: channelId, guildId, payload });
    return { delivered: true };
  }
}

export interface RealDiskTestFixture {
  tempDir: string;
  dbPath: string;
  backupDir: string;
  exportDir: string;
  delivery: SpyDiscordDeliveryAdapter;
  container: PlatformContainer;
  reopenContainer(): PlatformContainer;
  cleanup(): void;
}

export function createRealSqliteTestFixture(): RealDiskTestFixture {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanveer-staff-monitor-test-'));
  const dbPath = path.join(tempDir, 'tanveer-monitor.sqlite');
  const backupDir = path.join(tempDir, 'backups');
  const exportDir = path.join(tempDir, 'exports');

  const config: AppConfig = Object.freeze({
    discordToken: 'test-token-never-logged',
    discordClientId: '123456789012345678',
    discordDevGuildId: '',
    globalOwnerId: GLOBAL_OWNER_ID,
    databasePath: dbPath,
    databaseBackupDir: backupDir,
    reportExportDir: exportDir,
    enableGuildMembersIntent: true,
    enablePresenceIntent: false,
    enableMessageContentIntent: true,
    defaultScanIntervalMinutes: 360,
    schedulerTickSeconds: 60,
    autoRegisterCommandsOnStartup: false,
    nodeEnv: 'test',
    logLevel: 'silent',
  });

  const delivery = new SpyDiscordDeliveryAdapter();
  let container = createPlatformContainer(config, delivery);

  return {
    tempDir,
    dbPath,
    backupDir,
    exportDir,
    delivery,
    get container() {
      return container;
    },
    reopenContainer(): PlatformContainer {
      container.shutdown();
      container = createPlatformContainer(config, delivery);
      return container;
    },
    cleanup(): void {
      try {
        container.shutdown();
      } catch {
        // already closed
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}
