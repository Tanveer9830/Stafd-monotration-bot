import { ALL_FEATURE_KEYS, FEATURE_LABELS, FeatureKey } from '../../types/domain';
import { PERMISSION_MATRIX } from '../../types/access';
import { assertLocal, brand, reply } from './shared';
import { CommandOperation } from './types';

export const SETTINGS_OPERATIONS: CommandOperation[] = [
  {
    root: 'settings',
    sub: 'inactivity',
    description: 'View or update inactivity thresholds',
    options: [
      { kind: 'integer', name: 'at_risk_hours', description: 'AT RISK threshold in hours', minValue: 1, maxValue: 720 },
      { kind: 'integer', name: 'inactive_hours', description: 'INACTIVE threshold in hours', minValue: 1, maxValue: 1440 },
      { kind: 'integer', name: 'escalation_hours', description: 'Escalation threshold in hours', minValue: 1, maxValue: 2160 },
      { kind: 'integer', name: 'observation_hours', description: 'New-staff observation baseline (hours)', minValue: 0, maxValue: 720 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'SETTINGS_INACTIVITY');
      const atRisk = interaction.options.getInteger('at_risk_hours', false);
      const inactive = interaction.options.getInteger('inactive_hours', false);
      const escalation = interaction.options.getInteger('escalation_hours', false);
      const observation = interaction.options.getInteger('observation_hours', false);
      if (atRisk !== null || inactive !== null || escalation !== null || observation !== null) {
        const updated = container.guildConfig.updateInactivityThresholds(access.guildId, access.userId, {
          ...(atRisk !== null ? { atRiskHours: atRisk } : {}),
          ...(inactive !== null ? { inactiveHours: inactive } : {}),
          ...(escalation !== null ? { escalationHours: escalation } : {}),
          ...(observation !== null ? { observationBaselineHours: observation } : {}),
        });
        await reply(
          interaction,
          brand(
            '✅ Inactivity Settings Updated',
            `🟡 At risk: **${updated.at_risk_hours}h**\n🔴 Inactive: **${updated.inactive_hours}h**\n🚨 Escalation: **${updated.escalation_hours}h**\n🆕 Observation baseline: **${updated.observation_baseline_hours}h**`,
            'success',
          ),
        );
        return;
      }
      const cfg = container.guildConfig.getGuildConfigOrThrow(access.guildId);
      await reply(
        interaction,
        brand(
          '⏱️ Inactivity Configuration',
          `🟡 At risk: **${cfg.at_risk_hours}h**\n🔴 Inactive: **${cfg.inactive_hours}h**\n🚨 Escalation: **${cfg.escalation_hours}h**\n🆕 Observation baseline: **${cfg.observation_baseline_hours}h**\nScan interval: **${cfg.scan_interval_minutes}m**\n\nInactivity never triggers automatic punishment; every incident requires human review.`,
          'cyan',
        ),
      );
    },
  },
  {
    root: 'settings',
    sub: 'alerts',
    description: 'Configure alert, log and DM fallback channels',
    options: [
      { kind: 'channel', name: 'alert_channel', description: 'Alert channel' },
      { kind: 'channel', name: 'log_channel', description: 'Audit log channel' },
      { kind: 'channel', name: 'fallback_channel', description: 'DM fallback channel' },
      {
        kind: 'string',
        name: 'feature',
        description: 'Optional feature switch to toggle',
        choices: ALL_FEATURE_KEYS.map((k) => ({ name: FEATURE_LABELS[k], value: k })),
      },
      { kind: 'boolean', name: 'enabled', description: 'Enable/disable the selected feature' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_SETTINGS', 'SETTINGS_ALERTS');
      const alert = interaction.options.getChannel('alert_channel', false);
      const log = interaction.options.getChannel('log_channel', false);
      const fallback = interaction.options.getChannel('fallback_channel', false);
      const feature = interaction.options.getString('feature', false) as FeatureKey | null;
      const enabled = interaction.options.getBoolean('enabled', false);
      if (alert || log || fallback) {
        container.guildConfig.updateGuildChannels(access.guildId, access.userId, {
          ...(alert ? { alertChannelId: alert.id } : {}),
          ...(log ? { logChannelId: log.id } : {}),
          ...(fallback ? { fallbackReviewChannelId: fallback.id } : {}),
        });
      }
      if (feature && enabled !== null) {
        container.features.setGuildFeature(access.guildId, access.userId, feature, enabled);
      }
      const cfg = container.guildConfig.getGuildConfigOrThrow(access.guildId);
      const features = container.features.listGuildFeatures(access.guildId);
      await reply(
        interaction,
        brand(
          '🔔 Alert & Feature Settings',
          [
            `**Alert channel:** ${cfg.alert_channel_id ? `<#${cfg.alert_channel_id}>` : '—'}`,
            `**Log channel:** ${cfg.log_channel_id ? `<#${cfg.log_channel_id}>` : '—'}`,
            `**Fallback channel:** ${cfg.fallback_review_channel_id ? `<#${cfg.fallback_review_channel_id}>` : '—'}`,
            '',
            ...features.map((f) => `${f.effectiveEnabled ? '🟢' : '🔴'} ${FEATURE_LABELS[f.key]}`),
          ].join('\n'),
          alert || log || fallback || feature ? 'success' : 'cyan',
        ),
      );
    },
  },
  {
    root: 'settings',
    sub: 'permissions',
    description: 'View effective permissions and the access matrix',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'SETTINGS_PERMISSIONS');
      const assignments = container.webRoles.listAssignments({ guildId: access.guildId });
      await reply(
        interaction,
        brand(
          '🔐 Effective Permissions',
          [
            `**Your access:** ${access.actorKind}`,
            `**Your scopes:** ${[...access.localScopes].map((s) => `\`${s}\``).join(', ') || 'none'}`,
            '',
            `**Server assignments:** ${assignments.length}`,
            ...assignments.slice(0, 10).map((a) => `• ${a.username} — ${a.role} (${a.permissions.length} scopes)`),
            '',
            ...PERMISSION_MATRIX.slice(0, 6).map((r) => `**${r.action}** — Owner ${r.globalOwner} · Co-owner ${r.serverCoOwner} · Admin ${r.serverAdmin} · Viewer ${r.viewer}`),
          ].join('\n'),
          'purple',
        ),
      );
    },
  },
];
