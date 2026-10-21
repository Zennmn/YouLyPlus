#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
npm run build
VERSION=$(node --input-type=module -e "import fs from 'node:fs'; process.stdout.write(JSON.parse(fs.readFileSync('manifest.json', 'utf8')).version)")
for BROWSER in chrome firefox; do
  if [ "$BROWSER" = firefox ]; then node scripts/package-chrome.mjs --firefox
  else node scripts/package-chrome.mjs; fi
  DESTINATION="dist/youlyplus-v${VERSION}-${BROWSER}.zip"
  rm -f -- "$DESTINATION"
  (cd "dist/youlyplus-amll-${BROWSER}" && zip -qr "../youlyplus-v${VERSION}-${BROWSER}.zip" .)
  echo "$DESTINATION"
done
