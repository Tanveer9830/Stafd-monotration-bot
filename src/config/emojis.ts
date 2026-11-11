import fs from 'node:fs';
import path from 'node:path';

export const EMOJI_KEYS = [
  'owner',
  'scanning',
  'active',
  'inactive',
  'warning',
  'approval',
  'rejection',
  'tickets',
  'security',
  'analytics',
  'success',
  'error',
  'premium',
  'loading',
  'database',
  'notifications',
  'performance',
] as const;

export type EmojiKey = (typeof EMOJI_KEYS)[number];

export interface EmojiManifestEntry {
  unicodeFallback: string;
  customEmoji: string;
  assetFile: string;
  animatedAssetFile?: string;
  description: string;
}

export interface EmojiManifestFile {
  project: string;
  creator: string;
  emojis: Record<EmojiKey, EmojiManifestEntry>;
}

const DEFAULT_FALLBACKS: Readonly<Record<EmojiKey, string>> = Object.freeze({
  owner: '👑',
  scanning: '🛰️',
  active: '🟢',
  inactive: '🔴',
  warning: '⚠️',
  approval: '✅',
  rejection: '✖️',
  tickets: '🎫',
  security: '🛡️',
  analytics: '📊',
  success: '✨',
  error: '🚨',
  premium: '💎',
  loading: '⏳',
  database: '🗄️',
  notifications: '🔔',
  performance: '⚡',
});

const CUSTOM_EMOJI_REGEX = /^<(a?):([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/;
const PLACEHOLDER_IDS = new Set([
  '000000000000000000',
  '111111111111111111',
  '123456789012345678',
  '999999999999999999',
]);

export interface ParsedCustomEmoji {
  raw: string;
  animated: boolean;
  name: string;
  id: string;
}

export function parseAndValidateCustomEmoji(value: string | undefined | null): ParsedCustomEmoji | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = CUSTOM_EMOJI_REGEX.exec(trimmed);
  if (!match) return null;
  const [, animatedFlag, name, id] = match;
  if (PLACEHOLDER_IDS.has(id) || /^(\d)\1{16,19}$/.test(id)) {
    return null;
  }
  return {
    raw: trimmed,
    animated: animatedFlag === 'a',
    name,
    id,
  };
}

export class EmojiManager {
  private entries: Record<EmojiKey, EmojiManifestEntry>;
  private verifiedAvailableIds: Set<string> | null = null;

  constructor(manifestPath?: string) {
    const resolvedPath = manifestPath ?? path.resolve(process.cwd(), 'assets/emojis/emoji-manifest.json');
    this.entries = this.loadManifest(resolvedPath);
  }

  private loadManifest(manifestPath: string): Record<EmojiKey, EmojiManifestEntry> {
    const fallbackEntries = {} as Record<EmojiKey, EmojiManifestEntry>;
    for (const key of EMOJI_KEYS) {
      fallbackEntries[key] = {
        unicodeFallback: DEFAULT_FALLBACKS[key],
        customEmoji: '',
        assetFile: `assets/emojis/tsm_${key}.png`,
        description: key,
      };
    }

    if (!fs.existsSync(manifestPath)) {
      return fallbackEntries;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<EmojiManifestFile>;
      if (raw.emojis) {
        for (const key of EMOJI_KEYS) {
          const candidate = raw.emojis[key];
          if (candidate) {
            fallbackEntries[key] = {
              unicodeFallback: candidate.unicodeFallback || DEFAULT_FALLBACKS[key],
              customEmoji: candidate.customEmoji || '',
              assetFile: candidate.assetFile || fallbackEntries[key].assetFile,
              animatedAssetFile: candidate.animatedAssetFile,
              description: candidate.description || key,
            };
          }
        }
      }
    } catch {
      return fallbackEntries;
    }
    return fallbackEntries;
  }

  /**
   * Optionally registers verified application/guild emoji IDs discovered at runtime.
   * If set, custom emojis whose IDs are not present in the verified set fall back to Unicode.
   */
  public setVerifiedEmojiIds(ids: Iterable<string> | null): void {
    this.verifiedAvailableIds = ids ? new Set(ids) : null;
  }

  /**
   * Resolves a configured emoji key, returning a validated Discord custom emoji
   * (respecting `allowAnimated` feature toggle) or its guaranteed Unicode fallback.
   */
  public get(key: EmojiKey, options?: { allowAnimated?: boolean }): string {
    const entry = this.entries[key];
    if (!entry) return DEFAULT_FALLBACKS[key] ?? '🔹';

    const parsed = parseAndValidateCustomEmoji(entry.customEmoji);
    if (!parsed) {
      return entry.unicodeFallback || DEFAULT_FALLBACKS[key];
    }

    if (parsed.animated && options?.allowAnimated === false) {
      return entry.unicodeFallback || DEFAULT_FALLBACKS[key];
    }

    if (this.verifiedAvailableIds && !this.verifiedAvailableIds.has(parsed.id)) {
      return entry.unicodeFallback || DEFAULT_FALLBACKS[key];
    }

    return parsed.raw;
  }

  /**
   * Returns a Discord component-compatible emoji identifier (`{ id, name, animated }` or Unicode string).
   */
  public forComponent(
    key: EmojiKey,
    options?: { allowAnimated?: boolean },
  ): { id: string; name: string; animated: boolean } | string {
    const entry = this.entries[key];
    const parsed = parseAndValidateCustomEmoji(entry?.customEmoji);
    if (
      parsed &&
      !(parsed.animated && options?.allowAnimated === false) &&
      (!this.verifiedAvailableIds || this.verifiedAvailableIds.has(parsed.id))
    ) {
      return { id: parsed.id, name: parsed.name, animated: parsed.animated };
    }
    return entry?.unicodeFallback || DEFAULT_FALLBACKS[key];
  }

  public getManifestSummary(): Array<{
    key: EmojiKey;
    resolved: string;
    usingCustom: boolean;
    assetExists: boolean;
  }> {
    return EMOJI_KEYS.map((key) => {
      const entry = this.entries[key];
      const resolved = this.get(key);
      const parsed = parseAndValidateCustomEmoji(entry.customEmoji);
      const assetPath = path.resolve(process.cwd(), entry.assetFile);
      return {
        key,
        resolved,
        usingCustom: parsed !== null && resolved === parsed.raw,
        assetExists: fs.existsSync(assetPath),
      };
    });
  }
}

export const emojis = new EmojiManager();
