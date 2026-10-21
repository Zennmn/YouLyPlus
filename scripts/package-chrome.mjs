import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const browser = process.argv.includes('--firefox') ? 'firefox' : 'chrome';
const dist = resolve(root, 'dist');
const destination = resolve(dist, `youlyplus-amll-${browser}`);
const withinDist = relative(dist, destination);
if (!withinDist || withinDist.startsWith('..') || isAbsolute(withinDist)) throw new Error('Invalid package directory');
try { if (lstatSync(dist).isSymbolicLink()) throw new Error('Package parent must not be a symlink'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
for (const path of ['src', 'icons', '_locales', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'readme.md', 'docs']) {
  cpSync(resolve(root, path), resolve(destination, path), { recursive: true });
}
mkdirSync(resolve(destination, 'scripts'), { recursive: true });
cpSync(resolve(root, 'scripts/ttml-translate.py'), resolve(destination, 'scripts/ttml-translate.py'));
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
if (browser === 'chrome') {
  delete manifest.browser_specific_settings;
  delete manifest.background.scripts;
} else {
  delete manifest.background.service_worker;
  manifest.permissions = manifest.permissions.filter(permission => permission !== 'offscreen');
}
writeFileSync(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${browser} unpacked extension: ${destination}`);
