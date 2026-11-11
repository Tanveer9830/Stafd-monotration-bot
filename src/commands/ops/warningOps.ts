import { formatWarningLevelLabel } from '../../services/WarningService';
import { assertLocal, brand, reply, truncate } from './shared';
import { CommandOperation } from './types';

export const WARNING_OPERATIONS: CommandOperation[] = [
  {
    root: 'warning',
    sub: 'issue',
    description: 'Issue an authorized staff warning (delivered by DM when possible)',
    options: [
      { kind: 'user', name: 'user', description: 'Staff member to warn', required: true },
      { kind: 'string', name: 'reason', description: 'Official warning reason', required: true },
      { kind: 'string', name: 'note', description: 'Optional management note' },
      {
        kind: 'integer',
        name: 'level',
        description: 'Optional explicit warning level (defaults to progressive)',
        choices: [
          { name: 'Warning 1/3', value: 1 },
          { name: 'Warning 2/3', value: 2 },
          { name: 'Warning 3/3 — management review', value: 3 },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_WARNINGS', 'WARNING_ISSUE');
      const target = interaction.options.getUser('user', true);
      if (!container.roster.getStaffProfile(access.guildId, target.id)) {
        throw new Error(`<@${target.id}> has no staff profile in this server.`);
      }
      const reason = interaction.options.getString('reason', true);
      const note = interaction.options.getString('note', false) ?? null;
      const level = interaction.options.getInteger('level', false) as 1 | 2 | 3 | null;
      const warning = await container.warnings.issueWarning({
        guildId: access.guildId,
        staffUserId: target.id,
        reason,
        managementNote: note,
        issuedById: access.userId,
        approverId: access.userId,
        approverDisplayName: interaction.user.username,
        explicitLevel: level ?? undefined,
      });
      await reply(
        interaction,
        brand(
          '⚠️ Official Warning Issued',
          [
            `**Warning:** \`${warning.warning_id}\``,
            `**Staff:** <@${warning.staff_user_id}>`,
            `**Level:** ${formatWarningLevelLabel(warning.warning_level)}`,
            `**Reason:** ${truncate(warning.reason, 300)}`,
            `**DM delivery:** ${warning.dm_delivered ? '✅ delivered' : `⚠️ failed (${warning.dm_error ?? 'unknown'})`}`,
            `**Expires:** ${warning.expires_at ?? 'never'}`,
          ].join('\n'),
          warning.warning_level >= 3 ? 'danger' : 'warning',
        ),
      );
    },
  },
  {
    root: 'warning',
    sub: 'history',
    description: 'View warning history for the server or one staff member',
    options: [
      { kind: 'user', name: 'user', description: 'Optional staff member' },
      { kind: 'integer', name: 'limit', description: 'Rows (1-25)', minValue: 1, maxValue: 25 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_WARNINGS', 'WARNING_HISTORY');
      const user = interaction.options.getUser('user', false);
      const limit = interaction.options.getInteger('limit', false) ?? 15;
      const warnings = container.warnings.listWarnings(access.guildId, {
        staffUserId: user?.id,
        limit,
      });
      await reply(
        interaction,
        brand(
          `⚠️ Warning History (${warnings.length})`,
          warnings.length
            ? warnings
                .map(
                  (w) =>
                    `• \`${w.warning_id}\` — <@${w.staff_user_id}> · **${formatWarningLevelLabel(w.warning_level)}** · ${w.status} · ${w.approved_at}${w.removed_reason ? ` · removed: ${truncate(w.removed_reason, 80)}` : ''}`,
                )
                .join('\n')
            : 'No warnings recorded.',
          'warning',
        ),
      );
    },
  },
  {
    root: 'warning',
    sub: 'profile',
    description: 'Show warning progression and appeal status for a staff member',
    options: [{ kind: 'user', name: 'user', description: 'Staff member', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_STAFF', 'WARNING_PROFILE');
      const user = interaction.options.getUser('user', true);
      const active = container.warnings.listWarnings(access.guildId, { staffUserId: user.id, onlyActive: true });
      const all = container.warnings.listWarnings(access.guildId, { staffUserId: user.id, limit: 50 });
      const appeals = container.warnings.listAppeals(access.guildId, undefined, 50).filter((a) => a.staff_user_id === user.id);
      await reply(
        interaction,
        brand(
          `⚠️ Warning Profile — ${user.username}`,
          [
            `**Active warnings:** ${active.length} (next level ${Math.min(3, active.length + 1)}/3)`,
            `**Total warnings:** ${all.length}`,
            '',
            active.length
              ? active.map((w) => `• \`${w.warning_id}\` — ${formatWarningLevelLabel(w.warning_level)} — ${truncate(w.reason, 100)}`).join('\n')
              : 'No active warnings.',
            '',
            `**Appeals:** ${appeals.length ? appeals.map((a) => `\`${a.appeal_id}\` ${a.status}`).join(', ') : 'none'}`,
            '_Warnings never automatically kick, ban or demote a member._',
          ].join('\n'),
          'warning',
        ),
      );
    },
  },
  {
    root: 'warning',
    sub: 'remove',
    description: 'Remove an active warning (mandatory audit reason)',
    options: [
      { kind: 'string', name: 'warning_id', description: 'Warning ID', required: true },
      { kind: 'string', name: 'reason', description: 'Mandatory removal reason', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_WARNINGS', 'WARNING_REMOVE');
      const warningId = interaction.options.getString('warning_id', true);
      const reason = interaction.options.getString('reason', true);
      const removed = container.warnings.removeWarning({
        guildId: access.guildId,
        warningId,
        actorUserId: access.userId,
        removalReason: reason,
      });
      await reply(
        interaction,
        brand('✅ Warning Removed', `Warning \`${removed.warning_id}\` removed from <@${removed.staff_user_id}>.\nReason: ${truncate(reason, 200)}`, 'success'),
      );
    },
  },
];
