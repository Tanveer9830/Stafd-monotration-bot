import { PERMISSION_MATRIX, ROLE_ALLOWED_SCOPES, WEB_ROLE_LABELS } from '../../types/access';
import { assertLocal, brand, reply, resolveAccess } from './shared';
import { CommandOperation } from './types';

export const ADMIN_OPERATIONS: CommandOperation[] = [
  {
    root: 'admin',
    sub: 'add',
    description: 'Assign SERVER_ADMIN website access to a member (server owner / Global Owner)',
    options: [
      { kind: 'user', name: 'user', description: 'Member to appoint as Server Administrator', required: true },
      {
        kind: 'string',
        name: 'permissions',
        description: 'Optional comma-separated scopes (defaults to the Server Administrator template)',
      },
      { kind: 'integer', name: 'expires_days', description: 'Optional access expiry in days', minValue: 1, maxValue: 3650 },
    ],
    handler: async ({ interaction, container }) => {
      const access = await resolveAccess(interaction, container);
      if (!access.isGlobalOwner && !access.isServerOwner) {
        container.audit.log({
          guildId: access.guildId,
          actorUserId: access.userId,
          actionCategory: 'UNAUTHORIZED_ATTEMPT',
          actionType: 'ADMIN_ADD_DENIED',
        });
        throw new Error('Access Denied: only the actual Discord server owner or Global Owner can assign Server Administrators.');
      }
      const target = interaction.options.getUser('user', true);
      const raw = interaction.options.getString('permissions', false);
      const days = interaction.options.getInteger('expires_days', false);
      const permissions = raw
        ? raw.split(',').map((s) => s.trim().toUpperCase()).filter((s) => (ROLE_ALLOWED_SCOPES.SERVER_ADMIN as readonly string[]).includes(s))
        : undefined;
      if (raw && (!permissions || permissions.length === 0)) {
        throw new Error(`No valid permissions supplied. Valid scopes: ${ROLE_ALLOWED_SCOPES.SERVER_ADMIN.join(', ')}`);
      }
      const assignment = container.webRoles.assignRole(
        container.authz.toRoleActor(access, interaction.user.username),
        {
          targetUserId: target.id,
          targetUsername: target.username,
          guildId: access.guildId,
          role: 'SERVER_ADMIN',
          permissions,
          expiresAt: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
          reason: 'Assigned with /admin add',
        },
      );
      await reply(
        interaction,
        brand(
          '✅ Server Administrator Assigned',
          [
            `**Member:** ${target.username} (\`${target.id}\`)`,
            `**Server:** ${access.guildName} (\`${access.guildId}\`)`,
            `**Role:** ${WEB_ROLE_LABELS.SERVER_ADMIN}`,
            `**Permissions:** ${assignment.permissions.map((p) => `\`${p}\``).join(', ')}`,
            `**Expires:** ${assignment.expires_at ?? 'never'}`,
            '',
            'This grants website access for **this server only**. It never creates a Global Administrator.',
          ].join('\n'),
          'success',
        ),
      );
    },
  },
  {
    root: 'admin',
    sub: 'remove',
    description: 'Revoke a member’s Server Administrator access',
    options: [{ kind: 'user', name: 'user', description: 'Server Administrator to revoke', required: true }],
    handler: async ({ interaction, container }) => {
      const access = await resolveAccess(interaction, container);
      if (!access.isGlobalOwner && !access.isServerOwner) {
        throw new Error('Access Denied: only the actual Discord server owner or Global Owner can revoke Server Administrators.');
      }
      const target = interaction.options.getUser('user', true);
      const assignments = container.webRoles
        .listAssignments({ guildId: access.guildId, userId: target.id })
        .filter((a) => a.role === 'SERVER_ADMIN');
      if (assignments.length === 0) {
        await reply(interaction, brand('⚠️ Not Found', `**${target.username}** has no active Server Administrator assignment in this server.`, 'warning'));
        return;
      }
      for (const assignment of assignments) {
        container.webRoles.revokeAssignment(
          container.authz.toRoleActor(access, interaction.user.username),
          assignment.assignment_id,
          'Revoked with /admin remove',
        );
      }
      await reply(
        interaction,
        brand(
          '✅ Server Administrator Revoked',
          `Revoked **${assignments.length}** Server Administrator assignment(s) for **${target.username}** (\`${target.id}\`). Access is revoked immediately.`,
          'success',
        ),
      );
    },
  },
  {
    root: 'admin',
    sub: 'list',
    description: 'List server administrators, co-owners and viewers with scoped access',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'ADMIN_LIST');
      const assignments = container.webRoles.listAssignments({ guildId: access.guildId });
      const legacy = container.permissions.listGuildPermissionAssignments(access.guildId);
      await reply(
        interaction,
        brand(
          `🛡️ Server Access Assignments (${assignments.length + legacy.length})`,
          [
            `**Actual Discord Owner:** \`${access.isServerOwner ? access.userId : 'verified server owner'}\``,
            '',
            assignments.length
              ? assignments
                  .map(
                    (a) =>
                      `• **${a.username}** (\`${a.user_id}\`) — ${WEB_ROLE_LABELS[a.role]} ${a.status === 'ACTIVE' ? '' : `[${a.status}]`} · ${a.permissions.length} scopes${a.expires_at ? ` · expires ${a.expires_at.slice(0, 10)}` : ''}`,
                  )
                  .join('\n')
              : 'No website role assignments for this server.',
            legacy.length
              ? `\n**Legacy reviewer permissions:**\n${legacy.map((l) => `• \`${l.target_id}\` — ${l.permission_level}`).join('\n')}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
          'cyan',
        ),
      );
    },
  },
  {
    root: 'admin',
    sub: 'permissions',
    description: 'Show the access permission matrix and assignable scopes',
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_OVERVIEW', 'ADMIN_PERMISSIONS');
      const matrix = PERMISSION_MATRIX.map(
        (row) =>
          `**${row.action}**\nOwner ${row.globalOwner} · G.Admin ${row.globalAdmin} · S.Owner ${row.serverOwner} · Co-owner ${row.serverCoOwner} · Admin ${row.serverAdmin} · Viewer ${row.viewer}`,
      );
      await reply(
        interaction,
        brand(
          '🔐 Permission Matrix',
          [
            `Largest role you hold in ${access.guildName}: \`${access.actorKind}\``,
            '',
            ...matrix.slice(0, 8),
            '',
            '**Server Administrator Scopes:**',
            ROLE_ALLOWED_SCOPES.SERVER_ADMIN.map((s) => `\`${s}\``).join(', '),
          ].join('\n'),
          'purple',
        ),
      );
    },
  },
  {
    root: 'admin',
    sub: 'audit',
    description: 'View local role and permission audit history',
    options: [{ kind: 'integer', name: 'limit', description: 'Rows (1-25)', minValue: 1, maxValue: 25 }],
    handler: async ({ interaction, container }) => {
      const access = await assertLocal(interaction, container, 'SERVER_VIEW_AUDIT', 'ADMIN_AUDIT');
      const limit = interaction.options.getInteger('limit', false) ?? 15;
      const logs = container.audit.listGuildLogs(access.guildId, { limit }).filter((l) =>
        ['ACCESS_ROLES', 'PERMISSIONS', 'UNAUTHORIZED_ATTEMPT', 'OWNER_SECURITY'].includes(l.action_category),
      );
      await reply(
        interaction,
        brand(
          `🗄️ Access Audit History (${logs.length})`,
          logs.length
            ? logs
                .map((l) => `• \`${l.audit_id}\` [${l.action_category}] **${l.action_type}** — actor \`${l.actor_user_id}\` · ${l.created_at}`)
                .join('\n')
            : 'No access-control audit entries recorded yet.',
          'midnight',
        ),
      );
    },
  },
];
