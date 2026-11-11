import fs from 'node:fs';
import path from 'node:path';

const srcDir = path.resolve(process.cwd(), 'src/database/migrations');
const destDir = path.resolve(process.cwd(), 'dist/database/migrations');

fs.mkdirSync(destDir, { recursive: true });
for (const file of fs.readdirSync(srcDir)) {
  if (file.endsWith('.sql')) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
}

const publicSrc = path.resolve(process.cwd(), 'public');
const publicDest = path.resolve(process.cwd(), 'dist/public');
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, publicDest, { recursive: true });
  console.log('Copied dashboard assets to dist/public');
}
