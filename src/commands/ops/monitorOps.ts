import { assertLocal, brand, reply, resolveAccess } from './shared';
import { CommandOperation } from './types';

export const MONITOR_OPERATIONS: CommandOperation[] = [
  {
    root: 'monitor',
    sub: 'status',
    description: 'Show monitoring pause state and scheduler health',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'MONITOR_STATUS');
      const features = container.features.listGuildFeatures(access.guildId);
      const scanning = features.find((f) => f.key === 'scheduled_scanning');
      const activity = features.find((f) => f.key === 'activity_monitoring');
      const scheduler = container.scheduler.getSchedulerStatus().find((s) => s.lock_name.includes(access.guildId));
      await reply(
        interaction,
        brand(
          '🎛️ Monitoring Status',
          [
            `**Global monitoring paused:** ${container.settings.getBoolean('monitoring_paused_globally') ? 'yes' : 'no'}`,
            `**Scheduled scanning:** ${scanning?.effectiveEnabled ? '🟢 enabled' : '🔴 disabled'}`,
            `**Activity monitoring:** ${activity?.effectiveEnabled ? '🟢 enabled' : '🔴 disabled'}`,
            `**Scheduler:** ${scheduler ? `${scheduler.last_status ?? 'idle'} · next ${scheduler.next_run_at ?? '—'} · runs ${scheduler.run_count}` : 'not scheduled'}`,
            `**Scan interval:** ${container.guildConfig.getGuildConfigOrThrow(access.guildId).scan_interval_minutes} minutes`,
          ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'monitor',
    sub: 'start',
    description: 'Start monitoring: enable scanning and initialize schedules',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'MONITOR_START');
      container.features.setGuildFeature(access.guildId, access.userId, 'scheduled_scanning', true);
      container.features.setGuildFeature(access.guildId, access.userId, 'activity_monitoring', true);
      container.features.setGuildFeature(access.guildId, access.userId, 'roster_sync', true);
      container.scheduler.initializeSchedules();
      await reply(
        interaction,
        brand('▶️ Monitoring Started', 'Scheduled scanning, activity monitoring and roster sync are now enabled. Schedules initialized.', 'success'),
      );
    },
  },
  {
    root: 'monitor',
    sub: 'pause',
    description: 'Pause monitoring for this server',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'MONITOR_PAUSE');
      container.features.setGuildFeature(access.guildId, access.userId, 'scheduled_scanning', false);
      container.features.setGuildFeature(access.guildId, access.userId, 'activity_monitoring', false);
      await reply(
        interaction,
        brand('⏸️ Monitoring Paused', 'Scheduled scans and activity classification are paused for this server. Existing data is preserved; no inactivity incident will be created while paused.', 'warning'),
      );
    },
  },
  {
    root: 'monitor',
    sub: 'resume',
    description: 'Resume monitoring for this server',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'MONITOR_RESUME');
      container.features.setGuildFeature(access.guildId, access.userId, 'scheduled_scanning', true);
      container.features.setGuildFeature(access.guildId, access.userId, 'activity_monitoring', true);
      container.scheduler.initializeSchedules();
      await reply(interaction, brand('⏵️ Monitoring Resumed', 'Scheduled scans and activity monitoring resumed. Schedules re-initialized.', 'success'));
    },
  },
  {
    root: 'monitor',
    sub: 'thresholds',
    description: 'View or update inactivity thresholds (defaults 24h / 48h / 72h)',
    options: [
      { kind: 'integer', name: 'at_risk_hours', description: 'Hours before AT RISK', minValue: 1, maxValue: 720 },
      { kind: 'integer', name: 'inactive_hours', description: 'Hours before INACTIVE / review required', minValue: 1, maxValue: 1440 },
      { kind: 'integer', name: 'escalation_hours', description: 'Hours before high-priority escalation', minValue: 1, maxValue: 2160 },
      { kind: 'integer', name: 'scan_interval_minutes', description: 'Scan interval (15-1440 minutes)', minValue: 15, maxValue: 1440 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'MONITOR_THRESHOLDS');
      const atRisk = interaction.options.getInteger('at_risk_hours', false);
      const inactive = interaction.options.getInteger('inactive_hours', false);
      const escalation = interaction.options.getInteger('escalation_hours', false);
      const interval = interaction.options.getInteger('scan_interval_minutes', false);
      if (atRisk !== null || inactive !== null || escalation !== null || interval !== null) {
        const updated = container.guildConfig.updateInactivityThresholds(access.guildId, access.userId, {
          ...(atRisk !== null ? { atRiskHours: atRisk } : {}),
          ...(inactive !== null ? { inactiveHours: inactive } : {}),
          ...(escalation !== null ? { escalationHours: escalation } : {}),
          ...(interval !== null ? { scanIntervalMinutes: interval } : {}),
        });
        container.scheduler.initializeSchedules();
        await reply(
          interaction,
          brand(
            '✅ Thresholds Updated',
            `At-risk **${updated.at_risk_hours}h** · Inactive **${updated.inactive_hours}h** · Escalation **${updated.escalation_hours}h** · Scan every **${updated.scan_interval_minutes}m**.`,
            'success',
          ),
        );
        return;
      }
      const cfg = container.guildConfig.getGuildConfigOrThrow(access.guildId);
      await reply(
        interaction,
        brand(
          '🎛️ Inactivity Thresholds',
          `At-risk: **${cfg.at_risk_hours}h**\nInactive: **${cfg.inactive_hours}h**\nEscalation: **${cfg.escalation_hours}h**\nObservation baseline: **${cfg.observation_baseline_hours}h**\nScan interval: **${cfg.scan_interval_minutes}m**`,
          'cyan',
        ),
      );
    },
  },
];
