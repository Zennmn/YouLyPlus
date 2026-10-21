import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('manifest injects only Apple Music and references built local assets', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.content_scripts.length, 1);
  for (const entry of manifest.content_scripts) for (const path of entry.js) assert.ok(existsSync(new URL(path, root)), `Missing ${path}`);
  const apple = manifest.content_scripts[0];
  assert.deepEqual(apple.matches, ['https://music.apple.com/*']);
  assert.ok(apple.js.indexOf('src/lib/defaultSettings.js') < apple.js.indexOf('src/modules/lyrics/settings.js'));
  assert.ok(!apple.js.some(path => /lyricsRenderer|ytmusic|tidal/i.test(path)));
  assert.ok(!apple.js.includes('src/vendor/amll-player/player.js'), 'React and AMLL must not initialize in the Apple document');
  assert.ok(apple.js.indexOf('src/modules/applemusic/framePlayer.js') < apple.js.indexOf('src/modules/applemusic/index.js'));
  assert.ok(existsSync(new URL('src/vendor/amll-player/player.js', root)));
  assert.ok(manifest.web_accessible_resources.every(entry => entry.matches.every(match => match === 'https://music.apple.com/*')));
  const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources);
  for (const path of resources) assert.ok(existsSync(new URL(path, root)), `Missing ${path}`);
  assert.ok(resources.includes('src/player-frame/index.html'));
  assert.ok(resources.includes('src/inject/applemusic/songTracker.js'));
  assert.ok(resources.includes('src/modules/applemusic/style.css'));
});
