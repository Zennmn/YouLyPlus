import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function harness(parentOrigin = 'https://music.apple.com') {
  const parentListeners = new Map(), childListeners = new Map(), frameListeners = new Map();
  const timers = new Map(), childTimers = new Map(), calls = [], actions = [], sent = [];
  let nextTimer = 0, readyCount = 0, fallbackCount = 0, childOptions, childPlayer;
  const frameOrigin = 'chrome-extension://test';
  const timerAPI = map => ({ setTimeout(fn, ms) { map.set(++nextTimer, { fn, ms }); return nextTimer; }, clearTimeout(id) { map.delete(id); } });
  const parentWindow = { location: { origin: parentOrigin }, addEventListener: (name, fn) => parentListeners.set(name, fn), removeEventListener: name => parentListeners.delete(name) };
  const childWindow = { addEventListener: (name, fn) => childListeners.set(name, fn), removeEventListener: name => childListeners.delete(name) };
  parentWindow.postMessage = (message, target) => {
    assert.equal(target, parentOrigin); const data = structuredClone(message);
    queueMicrotask(() => parentListeners.get('message')?.({ source: childWindow, origin: frameOrigin, data }));
  };
  childWindow.postMessage = (message, target) => {
    assert.equal(target, frameOrigin); const data = structuredClone(message); sent.push(data);
    queueMicrotask(() => childListeners.get('message')?.({ source: parentWindow, origin: parentOrigin, data }));
  };
  const frame = { contentWindow: childWindow, addEventListener: (name, fn) => frameListeners.set(name, fn), removeEventListener: name => frameListeners.delete(name) };
  const parentContext = vm.createContext({ window: parentWindow, URL, crypto: { randomUUID: () => 'test-channel' }, navigator: { language: 'en' },
    document: { documentElement: { lang: 'zh-CN' } }, ...timerAPI(timers),
    pBrowser: { runtime: { getURL: path => frameOrigin + '/' + path } },
  });
  vm.runInContext(read('src/modules/applemusic/framePlayer.js'), parentContext);
  const options = {
    settings: { lightweight: false, appleMusicAMLLBackground: true, appleMusicPlayerFont: 'SimSun', appleMusicPlayerFontFile: { id: 'font-id', name: 'example.ttf' }, customLLMApiKey: 'PRIVATE', mediaUserToken: 'TOKEN' },
    translate: key => key === 'settings' ? '歌词设置' : '',
    onReady() { readyCount++; }, onFallback() { fallbackCount++; },
    sendCommand: async (...args) => { actions.push(['command', ...args]); return { accepted: true }; },
    onSettingsChange: async values => { actions.push(['settings', values]); },
    onClose: () => actions.push(['close']),
  };
  const api = parentContext.LyPlusAMLLFrame.createPlayer(frame, options);
  const childDocument = { documentElement: {}, getElementById: () => ({}), addEventListener: (name, fn) => childListeners.set(name, fn), removeEventListener: name => childListeners.delete(name) };
  const childContext = vm.createContext({ window: childWindow, parent: parentWindow, document: childDocument,
    location: { search: new URL(frame.src).search, protocol: 'chrome-extension:', origin: frameOrigin }, URLSearchParams, URL, ...timerAPI(childTimers),
    LyPlusAMLL: { createPlayer(_host, config) {
      childOptions = config;
      childPlayer = Object.fromEntries(['updateSong', 'displayLyrics', 'updateCurrentTick', 'updatePlayback', 'updateSettings', 'updateDisplayMode', 'setUserOffset', 'setAvailableProviders', 'setVisible', 'setTranslationLoading', 'showToast', 'displaySongNotFound', 'displaySongError', 'cleanupLyrics', 'dispose'].map(method => [method, (...args) => calls.push([method, ...args])]));
      queueMicrotask(config.onReady);
      return childPlayer;
    } },
  });
  vm.runInContext(read('src/player-frame/frame.js'), childContext);
  return { api, calls, actions, options, frame, parentWindow, childWindow, parentListeners, childListeners, frameListeners, timers, childTimers, sent,
    load: async () => { frameListeners.get('load')(); await settle(); },
    childOptions: () => childOptions, readyCount: () => readyCount, fallbackCount: () => fallbackCount,
  };
}

test('separate-document startup coalesces cold ticks, preserves latest media state and omits credentials', async () => {
  const h = harness();
  h.api.updateSong({ appleId: '1', title: 'Song', artwork: 'https://example.com/cover.jpg', appleMusicTTML: '<tt/>', mediaUserToken: 'TOKEN' });
  for (let i = 0; i < 2400; i++) h.api.updateCurrentTick(i / 240);
  h.api.updatePlayback({ isPlaying: true, currentTime: 10 });
  h.api.updateSettings(h.options.settings);
  assert.equal(h.calls.length, 0);
  await h.load();
  assert.equal(h.readyCount(), 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.calls.filter(call => call[0] === 'updateCurrentTick').length, 1);
  assert.equal(h.calls.find(call => call[0] === 'updateCurrentTick')[1], 2399 / 240);
  assert.equal(h.calls.find(call => call[0] === 'updateSong')[1].appleId, '1');
  assert.doesNotMatch(JSON.stringify(h.sent), /PRIVATE|TOKEN|appleMusicTTML/);
  assert.equal(h.childOptions().translate('settings'), '歌词设置');
  assert.equal(h.childOptions().settings.appleMusicPlayerFont, 'SimSun');
  assert.equal(h.childOptions().settings.appleMusicPlayerFontFile.id, 'font-id');
  h.api.updateSettings({ appleMusicPlayerFont: '' }); await settle();
  assert.equal(h.calls.filter(call => call[0] === 'updateSettings').at(-1)[1].appleMusicPlayerFont, '');
  h.api.dispose(); await settle();
});

test('lyric metadata and menu callbacks round-trip with original arguments and settings failures reject', async () => {
  const h = harness(), callbackCalls = [];
  const song = { appleId: '1', title: 'Song' }, lyrics = { type: 'Word', data: [{ text: 'Line', amll: { isBG: true } }] };
  const args = [lyrics, song, 'both', h.options.settings,
    (...values) => callbackCalls.push(['reload', ...values]), (...values) => callbackCalls.push(['mode', ...values]), 'lyrics', .12,
    (...values) => callbackCalls.push(['provider', ...values]), (...values) => callbackCalls.push(['offset', ...values]),
    () => ({ providerKeys: ['amll'], activeProvider: 'amll' }), 80];
  h.api.displayLyrics(...args);
  await h.load();
  const childArgs = h.calls.find(call => call[0] === 'displayLyrics').slice(1);
  assert.deepEqual(JSON.parse(JSON.stringify(childArgs[0])), lyrics);
  assert.equal(childArgs[11], 80);
  assert.equal(childArgs[10]().activeProvider, 'amll');
  childArgs[5]('translate', song); childArgs[8]('lunabeat', song); childArgs[9](song, -220); childArgs[4](song, false, true);
  await settle();
  assert.deepEqual(callbackCalls.map(call => call[0]), ['mode', 'provider', 'offset', 'reload']);
  assert.equal(callbackCalls[1][1], 'lunabeat'); assert.equal(callbackCalls[2][2], -220);
  assert.deepEqual(await h.childOptions().sendCommand('seek', 9.8), { accepted: true });
  await h.childOptions().onSettingsChange({ appleMusicAMLLBackground: false });
  assert.equal(h.actions.at(-1)[1].appleMusicAMLLBackground, false);
  await assert.rejects(h.childOptions().onSettingsChange({ customLLMApiKey: 'bad' }), /Invalid player setting/);
  h.options.onSettingsChange = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(h.childOptions().onSettingsChange({ appleMusicAMLLBackground: true }), /storage unavailable/);
  h.api.dispose(); await settle();
});

test('frame bridge rejects foreign window/origin/channel and unknown methods; Escape closes parent modal', async () => {
  const h = harness(); await h.load();
  const channel = new URL(h.frame.src).searchParams.get('channel');
  const valid = { type: 'LYPLUS_FRAME', channel, kind: 'action', id: 400, action: 'command', args: ['next'] };
  const listener = h.parentListeners.get('message');
  await listener({ source: {}, origin: 'chrome-extension://test', data: valid });
  await listener({ source: h.childWindow, origin: 'https://evil.example', data: valid });
  await listener({ source: h.childWindow, origin: 'chrome-extension://test', data: { ...valid, channel: 'wrong' } });
  assert.equal(h.actions.length, 0);
  const childListener = h.childListeners.get('message');
  childListener({ source: h.parentWindow, origin: 'https://evil.example', data: { type: 'LYPLUS_FRAME', channel, kind: 'call', method: 'updateSong', args: [{}] } });
  childListener({ source: h.parentWindow, origin: 'https://music.apple.com', data: { type: 'LYPLUS_FRAME', channel, kind: 'call', method: 'constructor', args: [] } });
  assert.equal(h.calls.filter(call => call[0] === 'updateSong').length, 0);
  h.childListeners.get('keydown')({ key: 'Escape', preventDefault() {} }); await settle();
  assert.equal(h.actions.at(-1)[0], 'close');
  h.api.dispose(); await settle();
});

test('blocked startup falls back, disposal clears listeners/timers and late ready cannot remount', async () => {
  const h = harness();
  [...h.timers.values()][0].fn(); assert.equal(h.fallbackCount(), 1);
  h.api.dispose(); await settle();
  assert.equal(h.timers.size, 0); assert.equal(h.parentListeners.size, 0); assert.equal(h.frameListeners.size, 0);
  assert.equal(h.readyCount(), 0);
  h.api.updateCurrentTick(20); assert.equal(h.sent.some(message => message.method === 'updateCurrentTick'), false);
  const running = harness(); await running.load();
  running.api.dispose(); await settle();
  assert.equal(running.calls.at(-1)[0], 'dispose');
  assert.equal(running.childTimers.size, 0);
  assert.equal(running.childListeners.has('message'), false);
});

test('extension frame refuses initialization from unrelated sites', async () => {
  const h = harness('https://evil.example'); await h.load();
  assert.equal(h.readyCount(), 0);
  assert.equal(h.calls.length, 0);
  h.api.dispose(); await settle();
});

test('parent replay keeps background and offset after frame recreation instead of depending on shared array mutations', () => {
  const source = read('src/modules/applemusic/index.js');
  const apiSource = source.slice(source.indexOf('const LyricsPlusAPI ='), source.indexOf('\nfunction queueMount('));
  const settingsSource = source.slice(source.indexOf("window.addEventListener('YOUPLUS_SETTINGS_UPDATED'"), source.indexOf("\nwindow.addEventListener('message'", source.indexOf("window.addEventListener('YOUPLUS_SETTINGS_UPDATED'")));
  const displayed = [], writes = [], listeners = new Map();
  const context = vm.createContext({
    currentSongInfo: { appleId: '1' }, currentSettings: { isEnabled: true }, cachedLyricsArguments: null, cachedOffset: 0,
    cachedLyricStatus: '', manualProviderSelected: false,
    songIdentity: song => song?.appleId,
    amllPlayer: { displayLyrics: (...args) => displayed.push(structuredClone(args.map(value => typeof value === 'function' ? null : value))), updateSettings() {} },
    window: { addEventListener: (name, fn) => listeners.set(name, fn), initializeLyricsPlusPlatform() {} },
    injectDOMScript() {}, unmountAMLL() {},
  });
  vm.runInContext(apiSource + '\nglobalThis.api = LyricsPlusAPI;\n' + settingsSource, context);
  const args = [{ data: [], provider: 'amll' }, { appleId: '1' }, 'translate', { appleMusicAMLLBackground: true }, null, null, 'lyrics', 0, null,
    (_song, value) => writes.push(value), () => ({}), 0];
  context.api.displayLyrics(...args);
  context.cachedLyricsArguments[9]({ appleId: '1' }, 220);
  assert.equal(context.cachedOffset, 220);
  assert.equal(context.cachedLyricsArguments[11], 220);
  assert.deepEqual(writes, [220]);
  listeners.get('YOUPLUS_SETTINGS_UPDATED')({ detail: { settings: { appleMusicAMLLBackground: false, largerTextMode: 'romanization' } } });
  assert.equal(context.cachedLyricsArguments[3].appleMusicAMLLBackground, false);
  assert.equal(context.cachedLyricsArguments[6], 'romanization');
});
