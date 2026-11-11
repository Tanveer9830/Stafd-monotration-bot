import { brand, reply, resolveAccess } from './shared';
import { CommandOperation } from './types';

export const SYSTEM_OPERATIONS: CommandOperation[] = [
  {
    root: 'system',
    sub: 'status',
    description: 'Show platform or server health status',
    handler: async ({ interaction, container }) => {
      if (container.authz.hasGlobalScope(interaction.user.id, 'GLOBAL_SYSTEM')) {
        const guilds = container.guildConfig.listAllGuilds();
        const scans = container.db.all<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM scan_history WHERE started_at >= ?",
          [new Date(Date.now() - 86_400_000).toISOString()],
        );
        const errors = container.db.get<{ cnt: number }>(
          "SELECT COUNT(*) AS cnt FROM monitoring_health WHERE status = 'ERROR'",
        );
        await reply(
          interaction,
          brand(
            '🛡️ Platform Health',
            [
              `**Registered servers:** ${guilds.length}`,
              `**Scans (24h):** ${scans[0]?.cnt ?? 0}`,
              `**Monitoring health errors:** ${errors?.cnt ?? 0}`,
              `**Database:** ${container.db.integrityCheck().ok ? '✅ integrity OK' : '❌ integrity errors'} (${container.db.driverNameUsed})`,
              `**Migrations applied:** ${container.migrator.listAppliedMigrations().length}`,
              `**Event listeners:** ${container.eventBus.listenerCount}`,
              `**Auto-claim delay:** ${container.settings.getNumber('ticket_auto_claim_minutes')}m`,
              `**Global monitoring paused:** ${container.settings.getBoolean('monitoring_paused_globally') ? 'yes' : 'no'}`,
            ].join('\n'),
            (errors?.cnt ?? 0) > 0 ? 'warning' : 'success',
          ),
        );
        return;
      }
      const access = await resolveAccess(interaction, container);
      container.authz.assertLocalScope(access, 'SERVER_VIEW_OVERVIEW', 'SYSTEM_STATUS_LOCAL');
      const scans = container.staffDiscovery.listScanHistory(access.guildId, 1);
      const health = container.db.get<{ status: string; checked_at: string }>(
        'SELECT status, checked_at FROM monitoring_health WHERE guild_id = ? ORDER BY checked_at DESC LIMIT 1',
        [access.guildId],
      );
      await reply(
        interaction,
        brand(
          '🛡️ Server Health',
          [
            `**Server:** ${access.guildName}`,
            `**Monitoring health:** ${health?.status ?? 'unknown'} (${health?.checked_at ?? 'never checked'})`,
            `**Last scan:** ${scans[0]?.completed_at ?? 'never'}`,
            `**Auto-claim delay:** ${container.settings.getNumber('ticket_auto_claim_minutes')}m`,
            `_Platform-wide health is visible only to the Global Owner._`,
          ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'system',
    sub: 'diagnostics',
    description: 'Show deep system diagnostics (Global Owner / granted global scope)',
    handler: async ({ interaction, container }) => {
      if (!container.authz.hasGlobalScope(interaction.user.id, 'GLOBAL_SYSTEM')) {
        container.audit.log({
          guildId: interaction.guildId ?? null,
          actorUserId: interaction.user.id,
          actionCategory: 'UNAUTHORIZED_ATTEMPT',
          actionType: 'SYSTEM_DIAGNOSTICS_DENIED',
        });
        throw new Error('Access Denied: platform diagnostics require the GLOBAL_SYSTEM scope.');
      }
      const integrity = container.db.integrityCheck();
      const migrations = container.migrator.listAppliedMigrations();
      const backups = container.backups.listBackups();
      const pendingTimers = container.db.get<{ cnt: number }>(
        "SELECT COUNT(*) FROM ticket_claim_timers WHERE status = 'PENDING'",
      );
      const memory = process.memoryUsage();
      await reply(
        interaction,
        brand(
          '🧪 System Diagnostics',
          [
            `**Node:** ${process.version}`,
            `**Uptime:** ${(process.uptime() / 3600).toFixed(2)}h`,
            `**Memory (RSS):** ${(memory.rss / 1024 / 1024).toFixed(1)} MB`,
            `**Database:** ${container.db.dbPath}`,
            `**Driver:** ${container.db.driverNameUsed}`,
            `**Integrity:** ${integrity.ok ? '✅ OK' : `❌ ${integrity.details.join(', ')}`}`,
            `**Migrations:** ${migrations.length} (latest ${migrations[migrations.length - 1]?.version ?? 'none'})`,
            `**Backups:** ${backups.length} (latest ${backups[0]?.createdAt ?? 'none'})`,
            `**Pending auto-claim timers:** ${pendingTimers?.cnt ?? 0}`,
            `**Intents:** members ${container.config.enableGuildMembersIntent ? 'on' : 'off'} · presence ${container.config.enablePresenceIntent ? 'on' : 'off'} · message content ${container.config.enableMessageContentIntent ? 'on' : 'off'}`,
          ].join('\n'),
          integrity.ok ? 'success' : 'danger',
        ),
      );
    },
  },
];
