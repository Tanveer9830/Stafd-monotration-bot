/**
 * TANVEER STAFF MONITOR — IMMUTABLE IDENTITY & PERMANENT BRANDING
 *
 * These constants are locked in source code and cannot be modified via
 * Discord commands, database configuration, or environment overrides.
 */

export const GLOBAL_OWNER_ID = '1131248987173814336' as const;
export const PROJECT_NAME = 'TANVEER STAFF MONITOR' as const;
export const CREATOR_NAME = 'TANVEER' as const;
export const CREATOR_IDENTITY = 'MADE BY TANVEER' as const;
export const CREATOR_DISCORD_USERNAME = 'tanveer5637' as const;
export const PERMANENT_EMBED_FOOTER = '⚡ Made by Tanveer | Discord: tanveer5637' as const;

export interface BrandingConfig {
  readonly projectName: typeof PROJECT_NAME;
  readonly creatorName: typeof CREATOR_NAME;
  readonly creatorIdentity: typeof CREATOR_IDENTITY;
  readonly creatorDiscordUsername: typeof CREATOR_DISCORD_USERNAME;
  readonly globalOwnerId: typeof GLOBAL_OWNER_ID;
  readonly permanentFooter: typeof PERMANENT_EMBED_FOOTER;
}

export const BRANDING: BrandingConfig = Object.freeze({
  projectName: PROJECT_NAME,
  creatorName: CREATOR_NAME,
  creatorIdentity: CREATOR_IDENTITY,
  creatorDiscordUsername: CREATOR_DISCORD_USERNAME,
  globalOwnerId: GLOBAL_OWNER_ID,
  permanentFooter: PERMANENT_EMBED_FOOTER,
});

/**
 * Strictly checks whether the provided Discord user ID matches the sole
 * permanent Global Owner ID ("1131248987173814336").
 *
 * Never inspects usernames, display names, nicknames, role names, guild ownership,
 * or Discord Administrator permissions.
 */
export function isPermanentGlobalOwner(userId: unknown): userId is typeof GLOBAL_OWNER_ID {
  return typeof userId === 'string' && userId === GLOBAL_OWNER_ID;
}
