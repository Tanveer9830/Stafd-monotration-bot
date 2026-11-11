import { assertLocal, brand, reply } from './shared';
import { CommandOperation } from './types';

export const INTEGRATION_OPERATIONS: CommandOperation[] = [
  {
    root: 'integration',
    sub: 'list',
    description: 'List configured ticket integrations and adapter capabilities',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_TICKETS', 'INTEGRATION_LIST');
      const configs = container.db.all<{
        id: string;
        integration_type: string;
        external_name: string | null;
        is_active: number;
        updated_at: string;
      }>(
        'SELECT id, integration_type, external_name, is_active, updated_at FROM integration_configs WHERE guild_id = ? ORDER BY created_at ASC',
        [access.guildId],
      );
      const adapters = container.tickets.adapterRegistry.listAll();
      await reply(
        interaction,
        brand(
          `🔌 Ticket Integrations (${configs.length})`,
          [
            ...(configs.length
              ? configs.map((c) => `• \`${c.id}\` — **${c.integration_type}**${c.external_name ? ` (${c.external_name})` : ''} · ${c.is_active ? 'active' : 'inactive'} · ${c.updated_at}`)
              : ['No integration records configured. `/ticket setup` already enables direct Discord observation.']),
            '',
            '**Available adapters:**',
            ...adapters.map((a) => `• \`${a.id}\` — ${a.displayName} · supported events: ${a.supportedEvents.join(', ') || 'none'}\n  Limitations: ${a.limitations.slice(0, 2).join('; ') || 'none documented'}`),
            '',
            '_Integrations only report events that are genuinely observable._',
          ].join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'integration',
    sub: 'setup',
    description: 'Configure a per-server ticket integration record',
    options: [
      {
        kind: 'string',
        name: 'type',
        description: 'Integration type',
        required: true,
        choices: [
          { name: 'Ticket Tool', value: 'ticket-tool' },
          { name: 'Tickets v2', value: 'tickets-v2' },
          { name: 'Custom Discord pattern', value: 'custom' },
          { name: 'Webhook relay', value: 'webhook' },
          { name: 'Direct Discord', value: 'discord' },
        ],
      },
      { kind: 'string', name: 'name', description: 'Human-readable integration name' },
      { kind: 'string', name: 'config', description: 'Optional JSON configuration (validated)' },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_INTEGRATIONS', 'INTEGRATION_SETUP');
      const type = interaction.options.getString('type', true);
      const name = interaction.options.getString('name', false) ?? type;
      const rawConfig = interaction.options.getString('config', false);
      let config: unknown = {};
      if (rawConfig) {
        try {
          config = JSON.parse(rawConfig);
        } catch {
          throw new Error('Integration config must be valid JSON.');
        }
        if (typeof config !== 'object' || config === null || Array.isArray(config)) {
          throw new Error('Integration config must be a JSON object.');
        }
      }
      const id = `INT-${Date.now().toString(36).toUpperCase()}`;
      const now = new Date().toISOString();
      container.db.run(
        `INSERT INTO integration_configs (id, guild_id, integration_type, external_id, external_name, is_active, config_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, 1, ?, ?, ?, ?)
         ON CONFLICT(guild_id, integration_type, external_id) DO UPDATE SET
           external_name = excluded.external_name, config_json = excluded.config_json,
           is_active = 1, updated_at = excluded.updated_at`,
        [id, access.guildId, type, name, JSON.stringify(config), access.userId, now, now],
      );
      container.audit.log({
        guildId: access.guildId,
        actorUserId: access.userId,
        actionCategory: 'SETTINGS',
        actionType: 'INTEGRATION_CONFIGURED',
        targetType: 'INTEGRATION',
        targetId: id,
        after: { type, name },
      });
      await reply(
        interaction,
        brand(
          '🔌 Integration Configured',
          `**ID:** \`${id}\`\n**Type:** \`${type}\`\n**Name:** ${name}\n\nConfigure the corresponding ticket category/channel with \`/ticket setup\` so events can be observed.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'integration',
    sub: 'test',
    description: 'Test ticket integration observability and channel permissions',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_INTEGRATIONS', 'INTEGRATION_TEST');
      const diag = container.tickets.runDiagnostics(access.guildId, undefined, container.config.enableMessageContentIntent);
      const configs = container.tickets.listTicketChannelConfigs(access.guildId);
      await reply(
        interaction,
        brand(
          '🧪 Integration Test',
          [
            `**Configured targets:** ${configs.length}`,
            `**Coverage:** \`${diag.coverageLevel}\``,
            `**Accessible channels:** ${diag.accessibleCount} · **Inaccessible:** ${diag.inaccessibleCount}`,
            '',
            ...diag.adapterReports.map(
              (a) =>
                `**${a.adapterName}** (\`${a.adapterId}\`)\n• Health: ${a.healthy ? '✅' : '⚠️'}\n• Supported events: ${a.supportedEvents.join(', ') || 'none'}\n• Limitations: ${a.observableLimitations.join('; ') || 'none'}\n• Missing permissions: ${a.missingPermissions.join(', ') || 'none'}`,
            ),
          ].join('\n'),
          diag.coverageLevel === 'FULL' ? 'success' : 'warning',
        ),
      );
    },
  },
];
