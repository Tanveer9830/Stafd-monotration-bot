import fs from 'node:fs';
import path from 'node:path';
import { REST, Routes } from 'discord.js';
import { EMOJI_KEYS, EmojiManifestFile } from '../src/config/emojis';
import { loadAppConfig } from '../src/config/env';

async function main(): Promise<void> {
  const config = loadAppConfig();
  if (!config.discordToken || !config.discordClientId) {
    throw new Error(
      'Live DISCORD_TOKEN and DISCORD_CLIENT_ID are required in .env to upload Application Emojis to Discord.',
    );
  }

  const manifestPath = path.resolve(process.cwd(), 'assets/emojis/emoji-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as EmojiManifestFile;
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const existing = (await rest.get(Routes.applicationEmojis(config.discordClientId))) as {
    items?: Array<{ id: string; name: string; animated?: boolean }>;
  };
  const existingByName = new Map((existing.items ?? []).map((e) => [e.name, e]));

  let uploadedCount = 0;
  for (const key of EMOJI_KEYS) {
    const entry = manifest.emojis[key];
    const emojiName = `tsm_${key}`;
    const already = existingByName.get(emojiName);

    if (already) {
      entry.customEmoji = `<${already.animated ? 'a' : ''}:${already.name}:${already.id}>`;
      continue;
    }

    const useAnimated = Boolean(entry.animatedAssetFile && fs.existsSync(path.resolve(process.cwd(), entry.animatedAssetFile)));
    const fileToUpload = path.resolve(
      process.cwd(),
      useAnimated && entry.animatedAssetFile ? entry.animatedAssetFile : entry.assetFile,
    );
    const mime = useAnimated ? 'image/gif' : 'image/png';
    const base64 = fs.readFileSync(fileToUpload).toString('base64');

    const created = (await rest.post(Routes.applicationEmojis(config.discordClientId), {
      body: {
        name: emojiName,
        image: `data:${mime};base64,${base64}`,
      },
    })) as { id: string; name: string; animated?: boolean };

    entry.customEmoji = `<${created.animated ? 'a' : ''}:${created.name}:${created.id}>`;
    uploadedCount += 1;
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(
    `[TANVEER STAFF MONITOR] Synced ${EMOJI_KEYS.length} Application Emojis (${uploadedCount} newly uploaded) and updated assets/emojis/emoji-manifest.json.`,
  );
}

void main().catch((err) => {
  console.error('[EMOJI UPLOAD ERROR]', err instanceof Error ? err.message : err);
  process.exit(1);
});
