import { brand, reply } from './shared';
import { CommandOperation } from './types';

export const HELP_OPERATIONS: CommandOperation[] = [
  {
    root: 'help',
    sub: 'help',
    standalone: true,
    description: 'Show the approved command reference and permissions',
    handler: async ({ interaction, container }) => {
      // Resolved lazily to avoid a module cycle with the registry that imports this file.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { ALL_OPERATIONS } = require('../registry') as typeof import('../registry');
      const groups = new Map<string, string[]>();
      for (const op of ALL_OPERATIONS) {
        const key = op.root;
        const list = groups.get(key) ?? [];
        list.push(op.group ? `${op.group} ${op.sub}` : op.sub);
        groups.set(key, list);
      }
      const lines = [...groups.entries()].map(
        ([root, ops]) => `**/${root}** (${ops.length})\n${ops.map((o) => `\`${o}\``).join(' · ')}`,
      );
      await reply(
        interaction,
        brand(
          '📖 TANVEER STAFF MONITOR — Command Reference',
          [
            `Exactly **${ALL_OPERATIONS.length}** registered slash-command operations.`,
            '',
            ...lines,
            '',
            '**Access:** Global Owner exclusive actions are enforced on the backend. Server owners only see their own server; co-owners and administrators only receive explicitly granted scopes. Global Administrators never receive Global Owner identity.',
            '',
            `**Website dashboard:** \`${process.env.WEB_BASE_URL ?? 'configure WEB_BASE_URL'}\``,
          ].join('\n'),
          'primary',
          container.config.discordDevGuildId ? 'development' : undefined,
        ),
      );
    },
  },
];
