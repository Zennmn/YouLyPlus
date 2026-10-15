import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = resolve(root, 'dist/youlyplus-amll-chrome');
mkdirSync(destination, { recursive: true });
for (const path of ['src', 'icons', '_locales', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'readme.md']) {
  cpSync(resolve(root, path), resolve(destination, path), { recursive: true });
}
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
delete manifest.browser_specific_settings;
delete manifest.background.scripts;
writeFileSync(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Chrome unpacked extension: ${destination}`);
