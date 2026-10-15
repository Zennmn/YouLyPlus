import test from 'node:test';
import assert from 'node:assert/strict';
import { browserFullscreen } from '../src/background/services/browserFullscreen.js';

function browser(state = 'maximized') {
  const calls = [], saved = {};
  const api = {
    windows: {
      async get(id) { calls.push(['get', id]); return { id, state }; },
      async update(id, update) { calls.push(['update', id, update]); state = update.state; return { id, state }; },
    },
    storage: { session: {
      async get(key) { return { [key]: saved[key] }; },
      async set(values) { Object.assign(saved, values); },
    } },
  };
  return { api, calls };
}
const sender = { tab: { windowId: 7 } };

test('fullscreen toggles only the sender window and restores normal or maximized state', async () => {
  for (const state of ['normal', 'maximized']) {
    const { api, calls } = browser(state);
    assert.deepEqual(await browserFullscreen({ operation: 'get' }, sender, api), { fullscreen: false });
    assert.deepEqual(await browserFullscreen({ operation: 'toggle', windowId: 999 }, sender, api), { fullscreen: true });
    assert.deepEqual(await browserFullscreen({ operation: 'get' }, sender, api), { fullscreen: true });
    assert.deepEqual(await browserFullscreen({ operation: 'toggle' }, sender, api), { fullscreen: false });
    assert.deepEqual(calls.filter(c => c[0] === 'update'), [['update', 7, { state: 'fullscreen' }], ['update', 7, { state }]]);
  }
});

test('rapid toggles serialize and an existing F11 fullscreen window can exit', async () => {
  const { api, calls } = browser();
  const result = await Promise.all([browserFullscreen({ operation: 'toggle' }, sender, api), browserFullscreen({ operation: 'toggle' }, sender, api)]);
  assert.deepEqual(result, [{ fullscreen: true }, { fullscreen: false }]);
  assert.equal(calls.filter(c => c[0] === 'update').length, 2);
  const existing = browser('fullscreen');
  await browserFullscreen({ operation: 'toggle' }, { tab: { windowId: 8 } }, existing.api);
  assert.deepEqual(existing.calls.at(-1), ['update', 8, { state: 'normal' }]);
});

test('invalid senders/actions and API failures never change another window', async () => {
  const { api, calls } = browser();
  await assert.rejects(browserFullscreen({ operation: 'toggle' }, {}, api), /unavailable/);
  await assert.rejects(browserFullscreen({ operation: 'arbitrary' }, sender, api), /Invalid/);
  assert.equal(calls.length, 0);
  api.windows.update = async () => { throw new Error('Window closed'); };
  await assert.rejects(browserFullscreen({ operation: 'toggle' }, sender, api), /Window closed/);
  assert.deepEqual(await browserFullscreen({ operation: 'get' }, sender, api), { fullscreen: false });
});
