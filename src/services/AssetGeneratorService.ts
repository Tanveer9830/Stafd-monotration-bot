import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import { BRANDING, PERMANENT_EMBED_FOOTER } from '../config/branding';
import { EMOJI_KEYS, EmojiKey } from '../config/emojis';
import { THEME_HEX } from '../config/theme';
import { BannerAssetKey } from '../utils/embeds';

const SYSTEM_FONTS = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
].filter((f) => fs.existsSync(f));

interface BannerSpec {
  key: BannerAssetKey;
  title: string;
  subtitle: string;
  accentColor: string;
}

const BANNER_SPECS: readonly BannerSpec[] = [
  {
    key: 'welcome',
    title: 'TANVEER STAFF MONITOR',
    subtitle: 'Enterprise Multi-Server Staff Activity & Ticket Intelligence',
    accentColor: THEME_HEX.neonCyan,
  },
  {
    key: 'staff-scanning',
    title: 'FULL ROSTER ACTIVITY SCANNER',
    subtitle: '6-Hour Persistent Schedule • Coverage & Workload Safety Verified',
    accentColor: THEME_HEX.brightPurple,
  },
  {
    key: 'ticket-monitoring',
    title: 'TICKET WORKLOAD ENGINE',
    subtitle: 'Response Speed • Meaningful Handling • Multi-Adapter Diagnostics',
    accentColor: THEME_HEX.neonCyan,
  },
  {
    key: 'warning-approval',
    title: 'HUMAN WARNING APPROVAL GATE',
    subtitle: 'Zero Auto-Punishments • Pre-Issue Safety Recheck • Full Audit',
    accentColor: THEME_HEX.amberWarning,
  },
  {
    key: 'owner-dashboard',
    title: 'GLOBAL OWNER COMMAND CENTER',
    subtitle: 'Cross-Server Telemetry • Security Policy • Global Inbox',
    accentColor: THEME_HEX.neonCyan,
  },
  {
    key: 'system-health',
    title: 'SYSTEM HEALTH & INTEGRITY',
    subtitle: 'SQLite WAL • Atomic Backups • Channel Coverage Verification',
    accentColor: THEME_HEX.greenSuccess,
  },
];

const EMOJI_BADGE_SPECS: Readonly<Record<EmojiKey, { symbol: string; ringColor: string }>> = {
  owner: { symbol: 'OWN', ringColor: '#22D3EE' },
  scanning: { symbol: 'SCN', ringColor: '#A855F7' },
  active: { symbol: 'ACT', ringColor: '#22C55E' },
  inactive: { symbol: 'INA', ringColor: '#EF4444' },
  warning: { symbol: 'WRN', ringColor: '#F59E0B' },
  approval: { symbol: 'OK', ringColor: '#22C55E' },
  rejection: { symbol: 'NO', ringColor: '#EF4444' },
  tickets: { symbol: 'TKT', ringColor: '#22D3EE' },
  security: { symbol: 'SEC', ringColor: '#7B2FBE' },
  analytics: { symbol: 'KPI', ringColor: '#A855F7' },
  success: { symbol: 'YES', ringColor: '#22C55E' },
  error: { symbol: 'ERR', ringColor: '#EF4444' },
  premium: { symbol: 'PRO', ringColor: '#22D3EE' },
  loading: { symbol: '...', ringColor: '#A855F7' },
  database: { symbol: 'SQL', ringColor: '#22D3EE' },
  notifications: { symbol: 'ALT', ringColor: '#F59E0B' },
  performance: { symbol: 'SPD', ringColor: '#22D3EE' },
};

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderSvgFrame(svg: string): { png: Buffer; pixels: Uint8Array; width: number; height: number } {
  const resvg = new Resvg(svg, {
    font: {
      fontFiles: SYSTEM_FONTS,
      loadSystemFonts: true,
      defaultFontFamily: 'DejaVu Sans',
    },
  });
  const rendered = resvg.render();
  return {
    png: Buffer.from(rendered.asPng()),
    pixels: new Uint8Array(rendered.pixels),
    width: rendered.width,
    height: rendered.height,
  };
}

function buildBannerSvgFrame(spec: BannerSpec, frameIndex: number, totalFrames: number): string {
  const width = 640;
  const height = 180;
  const t = frameIndex / totalFrames;
  const barX = Math.round(32 + t * 520);
  const pulseRadius = Math.round(18 + 8 * Math.sin(t * Math.PI * 2));
  const dotOpacity = (0.45 + 0.55 * Math.abs(Math.sin(t * Math.PI * 2))).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${THEME_HEX.deepMidnight}" />
        <stop offset="60%" stop-color="#2D154E" />
        <stop offset="100%" stop-color="#140924" />
      </linearGradient>
      <linearGradient id="accentBar" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="${THEME_HEX.primaryViolet}" />
        <stop offset="50%" stop-color="${spec.accentColor}" />
        <stop offset="100%" stop-color="${THEME_HEX.brightPurple}" />
      </linearGradient>
    </defs>

    <rect width="${width}" height="${height}" rx="14" fill="url(#bg)" />
    <rect x="6" y="6" width="${width - 12}" height="${height - 12}" rx="11" fill="none" stroke="${spec.accentColor}" stroke-width="1.5" stroke-opacity="0.7" />

    <!-- Animated neon scan bar -->
    <rect x="24" y="128" width="${width - 48}" height="6" rx="3" fill="#351C5C" />
    <rect x="${barX}" y="128" width="88" height="6" rx="3" fill="url(#accentBar)" />

    <!-- Pulsing status beacon -->
    <circle cx="585" cy="52" r="${pulseRadius}" fill="${spec.accentColor}" fill-opacity="0.18" />
    <circle cx="585" cy="52" r="8" fill="${spec.accentColor}" fill-opacity="${dotOpacity}" />

    <text x="28" y="42" fill="${THEME_HEX.brightPurple}" font-family="DejaVu Sans" font-size="11" font-weight="bold">${escapeXml(BRANDING.creatorIdentity)}  •  DISCORD: ${escapeXml(BRANDING.creatorDiscordUsername)}</text>
    <text x="28" y="76" fill="#F8FAFC" font-family="DejaVu Sans" font-size="22" font-weight="bold">${escapeXml(spec.title)}</text>
    <text x="28" y="104" fill="#CBD5E1" font-family="DejaVu Sans" font-size="12.5">${escapeXml(spec.subtitle)}</text>

    <text x="28" y="158" fill="${THEME_HEX.neonCyan}" font-family="DejaVu Sans" font-size="11.5" font-weight="bold">${escapeXml(PERMANENT_EMBED_FOOTER)}</text>
  </svg>`;
}

function buildEmojiSvgFrame(key: EmojiKey, frameIndex = 0, totalFrames = 1): string {
  const spec = EMOJI_BADGE_SPECS[key];
  const angle = Math.round((frameIndex / totalFrames) * 360);
  const pulse = (0.7 + 0.3 * Math.sin((frameIndex / totalFrames) * Math.PI * 2)).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <circle cx="64" cy="64" r="58" fill="${THEME_HEX.deepMidnight}" stroke="${THEME_HEX.primaryViolet}" stroke-width="6" />
    <g transform="rotate(${angle} 64 64)">
      <circle cx="64" cy="64" r="48" fill="none" stroke="${spec.ringColor}" stroke-width="5" stroke-dasharray="160 60" stroke-opacity="${pulse}" />
    </g>
    <text x="64" y="72" text-anchor="middle" fill="#F8FAFC" font-family="DejaVu Sans" font-size="26" font-weight="bold">${spec.symbol}</text>
  </svg>`;
}

export function generateAllVisualAssets(rootDir = process.cwd()): {
  bannersGenerated: string[];
  emojisGenerated: string[];
} {
  const bannersDir = path.resolve(rootDir, 'assets/banners');
  const emojisDir = path.resolve(rootDir, 'assets/emojis');
  fs.mkdirSync(bannersDir, { recursive: true });
  fs.mkdirSync(emojisDir, { recursive: true });

  const bannersGenerated: string[] = [];
  const emojisGenerated: string[] = [];

  const totalBannerFrames = 8;
  for (const spec of BANNER_SPECS) {
    // 1. Static PNG fallback
    const staticFrame = renderSvgFrame(buildBannerSvgFrame(spec, 2, totalBannerFrames));
    const pngPath = path.join(bannersDir, `${spec.key}.png`);
    fs.writeFileSync(pngPath, staticFrame.png);
    bannersGenerated.push(pngPath);

    // 2. Multi-frame Animated GIF
    const gif = GIFEncoder();
    for (let f = 0; f < totalBannerFrames; f += 1) {
      const frame = renderSvgFrame(buildBannerSvgFrame(spec, f, totalBannerFrames));
      const palette = quantize(frame.pixels, 128);
      const indexed = applyPalette(frame.pixels, palette);
      gif.writeFrame(indexed, frame.width, frame.height, { palette, delay: 110, repeat: 0 });
    }
    gif.finish();
    const gifPath = path.join(bannersDir, `${spec.key}.gif`);
    fs.writeFileSync(gifPath, Buffer.from(gif.bytes()));
    bannersGenerated.push(gifPath);
  }

  const animatedEmojiKeys = new Set<EmojiKey>(['owner', 'scanning', 'premium', 'loading']);
  for (const key of EMOJI_KEYS) {
    const pngFrame = renderSvgFrame(buildEmojiSvgFrame(key, 0, 1));
    const pngPath = path.join(emojisDir, `tsm_${key}.png`);
    fs.writeFileSync(pngPath, pngFrame.png);
    emojisGenerated.push(pngPath);

    if (animatedEmojiKeys.has(key)) {
      const gif = GIFEncoder();
      const frames = 6;
      for (let f = 0; f < frames; f += 1) {
        const frame = renderSvgFrame(buildEmojiSvgFrame(key, f, frames));
        const palette = quantize(frame.pixels, 64);
        const indexed = applyPalette(frame.pixels, palette);
        gif.writeFrame(indexed, frame.width, frame.height, { palette, delay: 120, repeat: 0 });
      }
      gif.finish();
      const gifPath = path.join(emojisDir, `tsm_${key}.gif`);
      fs.writeFileSync(gifPath, Buffer.from(gif.bytes()));
      emojisGenerated.push(gifPath);
    }
  }

  return { bannersGenerated, emojisGenerated };
}
