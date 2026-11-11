import fs from 'node:fs';
import path from 'node:path';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { BRANDING, PERMANENT_EMBED_FOOTER } from '../config/branding';
import { THEME_COLORS } from '../config/theme';

export type BannerAssetKey =
  | 'welcome'
  | 'staff-scanning'
  | 'ticket-monitoring'
  | 'warning-approval'
  | 'owner-dashboard'
  | 'system-health';

export type EmbedTone = 'primary' | 'purple' | 'cyan' | 'success' | 'warning' | 'danger' | 'midnight' | 'neutral';

const TONE_COLOR_MAP: Readonly<Record<EmbedTone, number>> = Object.freeze({
  primary: THEME_COLORS.primaryViolet,
  purple: THEME_COLORS.brightPurple,
  cyan: THEME_COLORS.neonCyan,
  success: THEME_COLORS.greenSuccess,
  warning: THEME_COLORS.amberWarning,
  danger: THEME_COLORS.redDanger,
  midnight: THEME_COLORS.deepMidnight,
  neutral: THEME_COLORS.neutralGray,
});

export interface BrandEmbedOptions {
  title: string;
  description?: string;
  tone?: EmbedTone;
  subtitle?: string;
  timestamp?: Date | boolean;
}

/**
 * Creates a standardized TANVEER STAFF MONITOR Discord Embed with immutable
 * creator identity and the exact permanent footer:
 * "⚡ Made by Tanveer | Discord: tanveer5637"
 */
export function createBrandEmbed(options: BrandEmbedOptions): EmbedBuilder {
  const tone = options.tone ?? 'primary';
  const embed = new EmbedBuilder()
    .setColor(TONE_COLOR_MAP[tone])
    .setAuthor({
      name: options.subtitle
        ? `${BRANDING.projectName} • ${options.subtitle}`
        : `${BRANDING.projectName} • ${BRANDING.creatorIdentity}`,
    })
    .setTitle(options.title)
    .setFooter({ text: PERMANENT_EMBED_FOOTER });

  if (options.description) {
    embed.setDescription(options.description);
  }

  if (options.timestamp !== false) {
    embed.setTimestamp(options.timestamp instanceof Date ? options.timestamp : new Date());
  }

  return embed;
}

/**
 * Resolves a banner visual asset (animated GIF when `allowAnimated` is true and GIF exists,
 * automatically falling back to static PNG). Never simulates animation by editing messages.
 */
export function attachBannerAsset(
  embed: EmbedBuilder,
  bannerKey: BannerAssetKey,
  allowAnimated = true,
  assetsDir = path.resolve(process.cwd(), 'assets/banners'),
): AttachmentBuilder | null {
  const gifPath = path.join(assetsDir, `${bannerKey}.gif`);
  const pngPath = path.join(assetsDir, `${bannerKey}.png`);

  if (allowAnimated && fs.existsSync(gifPath)) {
    const filename = `${bannerKey}.gif`;
    embed.setImage(`attachment://${filename}`);
    return new AttachmentBuilder(gifPath, { name: filename });
  }

  if (fs.existsSync(pngPath)) {
    const filename = `${bannerKey}.png`;
    embed.setImage(`attachment://${filename}`);
    return new AttachmentBuilder(pngPath, { name: filename });
  }

  return null;
}
