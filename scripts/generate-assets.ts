import { generateAllVisualAssets } from '../src/services/AssetGeneratorService';

const res = generateAllVisualAssets();
console.log(
  `[TANVEER STAFF MONITOR] Generated ${res.bannersGenerated.length} banner files and ${res.emojisGenerated.length} emoji asset files.`,
);
