import { assertLocal, brand, reply, resolveAccess, truncate } from './shared';
import { CommandOperation } from './types';

export const APPEAL_OPERATIONS: CommandOperation[] = [
  {
    root: 'appeal',
    sub: 'submit',
    description: 'Submit an appeal for one of your own warnings',
    options: [
      { kind: 'string', name: 'warning_id', description: 'Warning ID to appeal', required: true },
      { kind: 'string', name: 'reason', description: 'Explanation for the appeal', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await resolveAccess(interaction, container);
      const warningId = interaction.options.getString('warning_id', true);
      const warning = container.warnings.getWarningById(access.guildId, warningId);
      if (!warning) throw new Error(`Warning \`${warningId}\` was not found in this server.`);
      if (warning.staff_user_id !== access.userId) {
        throw new Error('You can only appeal your own warnings.');
      }
      const appeal = container.warnings.submitAppeal({
        guildId: access.guildId,
        warningId,
        staffUserId: access.userId,
        appealReason: interaction.options.getString('reason', true),
      });
      await reply(interaction, brand('🎫 Appeal Submitted', `Appeal \`${appeal.appeal_id}\` submitted for review.`, 'cyan'));
    },
  },
  {
    root: 'appeal',
    sub: 'list',
    description: 'List appeals by status',
    options: [
      {
        kind: 'string',
        name: 'status',
        description: 'Optional status filter',
        choices: [
          { name: 'Pending', value: 'PENDING' },
          { name: 'Approved', value: 'APPROVED' },
          { name: 'Rejected', value: 'REJECTED' },
        ],
      },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_APPEALS', 'APPEAL_LIST');
      const status = interaction.options.getString('status', false) as 'PENDING' | 'APPROVED' | 'REJECTED' | null;
      const appeals = container.warnings.listAppeals(access.guildId, status ?? undefined, 25);
      await reply(
        interaction,
        brand(
          `📬 Warning Appeals (${appeals.length})`,
          appeals.length
            ? appeals
                .map(
                  (a) =>
                    `• \`${a.appeal_id}\` — <@${a.staff_user_id}> · ${a.status} · warning \`${a.warning_id}\` · ${a.submitted_at}${a.decision_note ? `\n  Decision: ${truncate(a.decision_note, 100)}` : ''}`,
                )
                .join('\n')
            : 'No appeals found.',
          'cyan',
        ),
      );
    },
  },
  {
    root: 'appeal',
    sub: 'approve',
    description: 'Approve an appeal and overturn the warning',
    options: [
      { kind: 'string', name: 'appeal_id', description: 'Appeal ID', required: true },
      { kind: 'string', name: 'note', description: 'Decision note', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_APPEALS', 'APPEAL_APPROVE');
      const appeal = container.warnings.decideAppeal({
        guildId: access.guildId,
        appealId: interaction.options.getString('appeal_id', true),
        actorUserId: access.userId,
        actorDisplayName: interaction.user.username,
        decision: 'APPROVED',
        decisionNote: interaction.options.getString('note', true),
      });
      await reply(interaction, brand('✅ Appeal Approved', `Warning \`${appeal.warning_id}\` was overturned for <@${appeal.staff_user_id}>.`, 'success'));
    },
  },
  {
    root: 'appeal',
    sub: 'reject',
    description: 'Reject an appeal',
    options: [
      { kind: 'string', name: 'appeal_id', description: 'Appeal ID', required: true },
      { kind: 'string', name: 'note', description: 'Decision note', required: true },
    ],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_MANAGE_APPEALS', 'APPEAL_REJECT');
      const appeal = container.warnings.decideAppeal({
        guildId: access.guildId,
        appealId: interaction.options.getString('appeal_id', true),
        actorUserId: access.userId,
        actorDisplayName: interaction.user.username,
        decision: 'REJECTED',
        decisionNote: interaction.options.getString('note', true),
      });
      await reply(interaction, brand('✖️ Appeal Rejected', `Appeal \`${appeal.appeal_id}\` for <@${appeal.staff_user_id}> was rejected.\nNote: ${truncate(appeal.decision_note ?? '', 200)}`, 'warning'));
    },
  },
];
