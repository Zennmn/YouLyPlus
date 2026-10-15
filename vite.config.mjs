import { fileURLToPath } from 'node:url';
import { copyFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import svgr from 'vite-plugin-svgr';

const local = (path) => fileURLToPath(new URL(path, import.meta.url));
const core = local('./vendor/amll/packages/core/src/');

export default defineConfig({
  define: {
    // Library mode preserves process.env unless we explicitly compile browser dependencies for production.
    'process.env.NODE_ENV': JSON.stringify('production'),
    __LYPLUS_ROOT__: JSON.stringify(local('.').replaceAll('\\', '/').replace(/\/$/, '')),
  },
  server: { fs: { allow: [local('.')] } },
  root: local('./ui/applemusic-player'),
  plugins: [
    svgr({ svgrOptions: { ref: true } }),
    { name: 'amll-license', closeBundle() {
      copyFileSync(local('./vendor/amll/LICENSE'), local('./src/vendor/amll-player/LICENSE.txt'));
      copyFileSync(local('./node_modules/opencc-js/LICENSE'), local('./src/vendor/amll-player/OpenCC-LICENSE.txt'));
      copyFileSync(local('./node_modules/opencc-js/LICENSES/Apache-2.0.txt'), local('./src/vendor/amll-player/OpenCC-DATA-LICENSE.txt'));
      copyFileSync(local('./node_modules/opencc-js/THIRD_PARTY_LICENSES.md'), local('./src/vendor/amll-player/OpenCC-NOTICES.md'));
    } },
  ],
  resolve: {
    dedupe: ['react', 'react-dom', 'jotai'],
    alias: [
      { find: '@applemusic-like-lyrics/core', replacement: `${core}index.ts` },
      { find: '@applemusic-like-lyrics/react', replacement: local('./vendor/amll/packages/react/src/index.ts') },
      { find: '#interfaces', replacement: `${core}interfaces.ts` },
      { find: '#utils', replacement: `${core}utils` },
      { find: '#styles', replacement: `${core}styles` },
      { find: '#lyric', replacement: `${core}lyric-player` },
      { find: '#bg', replacement: `${core}bg-player` },
    ],
  },
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: local('./src/vendor/amll-player'),
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
    lib: {
      entry: local('./ui/applemusic-player/main.jsx'),
      name: 'LyPlusAMLL',
      formats: ['iife'],
      fileName: () => 'player.js',
      cssFileName: 'player',
    },
    rollupOptions: {
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.message.includes('use client')) return;
        warn(warning);
      },
      output: { inlineDynamicImports: true },
    },
  },
});
