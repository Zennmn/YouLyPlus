import { build } from 'vite';
import { copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = value => fileURLToPath(new URL(value, import.meta.url));
await build({
  configFile: false,
  build: {
    outDir: path('../src/vendor/amll-ttml/'),
    emptyOutDir: true,
    target: 'es2022',
    minify: false,
    lib: { entry: path('../ui/applemusic-player/ttml-entry.mjs'), formats: ['es'], fileName: () => 'parser.js' },
  },
});
copyFileSync(path('../vendor/amll/LICENSE'), path('../src/vendor/amll-ttml/LICENSE.txt'));
