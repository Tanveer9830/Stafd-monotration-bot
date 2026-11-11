import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { AuditService } from '../services/AuditService';
import { BRANDING, PERMANENT_EMBED_FOOTER, GLOBAL_OWNER_ID } from '../config/branding';
import { THEME_COLORS } from '../config/theme';
import { createBrandEmbed } from './embeds';
import { emojis } from '../config/emojis';
import { logger } from './logger';

export interface AccessDeniedContext {
  actorUserId: string;
  actorTag?: string;
  guildId?: string | null;
  actionDescription: string;
  requiredBy?: 'GLOBAL_OWNER' | 'SERVER_OWNER' | 'GLOBAL_OR_SERVER_OWNER';
  audit: AuditService;
}

/**
 * Creates a professional branded ACCESS DENIED embed and records the
 * unauthorized attempt in audit logs. This is the single source of truth
 * for all access-denied responses across the bot.
 */
export function createAccessDeniedEmbed(ctx: AccessDeniedContext): EmbedBuilder {
  const { actorUserId, actionDescription, requiredBy } = ctx;

  const isGlobalOwner = actorUserId === GLOBAL_OWNER_ID;

  let title: string;
  let description: string;

  if (requiredBy === 'GLOBAL_OWNER' || !isGlobalOwner) {
    title = `${emojis.get('error')} ACCESS DENIED — Global Owner Only`;
    description = `This administrative action is strictly reserved for the Permanent Global Owner.\n\n` +
      `**Required Identity:** Global Owner ID \`${GLOBAL_OWNER_ID}\`\n` +
      `**Your Identity:** \`${actorUserId}\`\n\n` +
      `**Action Blocked:** ${actionDescription}\n\n` +
      `This attempt has been recorded in the audit log.`;
  } else {
    title = `${emojis.get('error')} ACCESS DENIED — Insufficient Privileges`;
    description = `You do not have permission to perform this action.\n\n` +
      `**Action Blocked:** ${actionDescription}\n\n` +
      `This attempt has been recorded in the audit log.`;
  }

  return createBrandEmbed({
    title,
    description,
    tone: 'danger',
    subtitle: `${BRANDING.projectName} • Security Enforcement`,
  }).addFields(
    {
      name: 'Security Policy',
      value: 'Administrative and server-management commands are executable ONLY by the actual Discord Server Owner (guild ownerId) or the Permanent Global Owner (exact ID match). Co-Owners, Server Administrators, Management, Moderators, Helpers, Staff, and members with Discord Administrator permission are explicitly excluded.',
      inline: false,
    },
    {
      name: 'Your User ID',
      value: `\`${actorUserId}\``,
      inline: true,
    },
    {
      name: 'Required By',
      value: requiredBy ?? 'GLOBAL_OR_SERVER_OWNER',
      inline: true,
    }
  )
  .setFooter({ text: PERMANENT_EMBED_FOOTER });
}

/**
 * Logs an unauthorized administrative attempt to the audit log and throws
 * an AccessDenied error. All administrative command, button, modal, select,
 * and dashboard handlers should call this instead of throwing ad-hoc errors.
 */
export function assertAuthorizedOrDenied(ctx: AccessDeniedContext): void {
  const { actorUserId, actorTag, guildId, actionDescription, audit } = ctx;

  // Record the unauthorized attempt in audit logs
  audit.log({
    guildId: guildId ?? null,
    actorUserId,
    actorTag: actorTag ?? null,
    actionCategory: 'UNAUTHORIZED_ATTEMPT',
    actionType: 'ADMINISTRATIVE_ACCESS_DENIED',
    targetType: 'COMMAND',
    targetId: actionDescription,
    metadata: {
      required_by: ctx.requiredBy ?? 'GLOBAL_OR_SERVER_OWNER',
      is_global_owner: actorUserId === GLOBAL_OWNER_ID,
    },
  });

  logger.warn(
    {
      actorUserId,
      actorTag,
      guildId,
      actionDescription,
      requiredBy: ctx.requiredBy,
    },
    'Unauthorized administrative access attempt recorded',
  );

  throw new Error(`ACCESS_DENIED:${actionDescription}`);
}

/**
 * Creates an ACCESS DENIED button row for use in dashboards when a user
 * lacks permission to perform a dashboard action.
 */
export function createAccessDeniedButtonRow(customId = 'tsm:access:denied'): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('ACCESS DENIED')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(true)
      .setEmoji(emojis.get('error'))
  );
}
