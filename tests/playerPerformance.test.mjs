import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { atom, createStore } from 'jotai/vanilla';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const prebuilt = read('vendor/amll/packages/react-full/src/components/PrebuiltLyricPlayer/index.tsx');
const main = read('ui/applemusic-player/main.jsx');

test('lyric time subscription forwards 144/240Hz samples directly and cleans up on unmount', () => {
  const block = prebuilt.slice(prebuilt.indexOf('const PrebuiltCoreLyricPlayer:'), prebuilt.indexOf('const PrebuiltVolumeControl:'));
  assert.doesNotMatch(block, /useAtomValue\(musicPlayingPositionAtom\)/);
  const start = block.indexOf('\tuseLayoutEffect(() => {');
  const end = block.indexOf('\n\t}, [store, lyricTimeOffsetMs]);', start);
  assert.ok(start >= 0 && end > start);
  const subscription = block.slice(start, end + '\n\t}, [store, lyricTimeOffsetMs]);'.length);
  for (const rate of [144, 240]) {
    const store = createStore(), musicPlayingPositionAtom = atom(0), calls = [];
    let cleanup, effectCount = 0;
    const ref = { current: { lyricPlayer: { setCurrentTime: time => calls.push(time) } } };
    const context = vm.createContext({ store, musicPlayingPositionAtom, amllPlayerRef: ref, lyricTimeOffsetMs: 50,
      useLayoutEffect(effect) { effectCount++; cleanup = effect(); },
    });
    vm.runInContext(subscription, context);
    calls.length = 0;
    for (let i = 1; i <= rate; i++) store.set(musicPlayingPositionAtom, i * 1000 / rate);
    assert.equal(effectCount, 1);
    assert.equal(calls.length, rate);
    assert.deepEqual(calls, Array.from({ length: rate }, (_, i) => Math.max(0, Math.round((i + 1) * 1000 / rate - 50))));
    store.set(musicPlayingPositionAtom, 120000);
    assert.equal(calls.at(-1), 119950);
    store.set(musicPlayingPositionAtom, 1000);
    assert.equal(calls.at(-1), 950, 'backward seeks must remain immediate');
    const replacement = [];
    ref.current = { lyricPlayer: { setCurrentTime: time => replacement.push(time) } };
    store.set(musicPlayingPositionAtom, 2000);
    assert.deepEqual(replacement, [1950], 'a rebuilt core must receive the next sample');
    cleanup();
    store.set(musicPlayingPositionAtom, 3000);
    assert.deepEqual(replacement, [1950]);
  }
});

test('time labels subscribe to formatted text instead of re-rendering on every progress update', () => {
  const block = prebuilt.slice(prebuilt.indexOf('const TimeLabel:'), prebuilt.indexOf('const TotalDurationLabel:'));
  assert.match(block, /React\.memo/);
  const start = block.indexOf('\tconst labelAtom =');
  const end = block.indexOf('\n\tconst time =', start);
  for (const isRemaining of [false, true]) {
    const store = createStore(), musicPlayingPositionAtom = atom(0), musicDurationAtom = atom(200000);
    const context = vm.createContext({ atom, isRemaining, musicPlayingPositionAtom, musicDurationAtom,
      useMemo: build => build(), toDuration: seconds => String(Math.floor(seconds)),
    });
    vm.runInContext(`${block.slice(start, end)}\nglobalThis.label = labelAtom;`, context);
    let notifications = 0;
    const unsubscribe = store.sub(context.label, () => { notifications++; });
    for (let i = 1; i <= 240; i++) store.set(musicPlayingPositionAtom, i * 1000 / 240);
    assert.equal(notifications, 1);
    assert.equal(store.get(context.label), isRemaining ? '-199' : '1');
    unsubscribe();
  }
});

test('unchanged player UI patches do not cause redundant store notifications', () => {
  const start = main.indexOf('  const patchView =');
  const end = main.indexOf('\n  const zh =', start);
  const store = createStore(), viewAtom = atom({ connected: true, animated: true, displayMode: 'both' });
  let notifications = 0;
  const unsubscribe = store.sub(viewAtom, () => { notifications++; });
  const context = vm.createContext({ store, viewAtom });
  vm.runInContext(`${main.slice(start, end)}\nglobalThis.patch = patchView;`, context);
  for (let i = 0; i < 1000; i++) context.patch({ animated: true, displayMode: 'both' });
  assert.equal(notifications, 0);
  context.patch({ animated: false });
  assert.equal(notifications, 1);
  unsubscribe();
});

test('control snapshots update playback state without reapplying settings or converting lyrics', () => {
  const start = main.indexOf('    updatePlayback(state) {');
  const end = main.indexOf('\n    },', start);
  const store = createStore();
  const data = Object.fromEntries(['musicPlayingAtom', 'musicDurationAtom', 'musicVolumeAtom'].map(key => [key, atom(0)]));
  const controls = Object.fromEntries(['isShuffleActiveAtom', 'repeatModeAtom', 'isShuffleEnabledAtom', 'isRepeatEnabledAtom'].map(key => [key, atom(false)]));
  const viewAtom = atom({ connected: true }), samples = [];
  const context = vm.createContext({ destroyed: false, playback: {}, store, data, controls, viewAtom,
    diagnostics: { finish() {} },
    updateTick: value => samples.push(value), patchView() { throw new Error('unchanged connection should not patch UI'); },
    applySettings() { throw new Error('settings must stay out of the playback hot path'); },
  });
  const api = vm.runInContext(`({${main.slice(start, end)}\n}})`, context);
  for (let i = 0; i < 240; i++) api.updatePlayback({ currentTime: i / 240, isPlaying: true, duration: 200, volume: 0.7, repeat: 'off' });
  assert.equal(samples.length, 240);
  assert.equal(store.get(data.musicPlayingAtom), true);
  assert.equal(store.get(data.musicVolumeAtom), 0.7);
});
