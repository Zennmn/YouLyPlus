import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function browserContext() {
  class BrowserEvent { constructor(type) { this.type = type; } }
  const context = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder,
    performance: { now: () => 0 },
    navigator: { userAgent: 'Chrome', language: 'en-US' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      documentElement: { lang: 'en-US', style: {} }, body: {},
      createElement: () => ({
        style: {}, getContext: () => null,
        setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
        addEventListener() {}, removeEventListener() {},
      }),
      addEventListener() {}, removeEventListener() {}, querySelector: () => null,
    },
    EventTarget, Event: BrowserEvent, MouseEvent: BrowserEvent, CustomEvent: BrowserEvent,
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    MessageChannel: class { port1 = {}; port2 = { postMessage() {} }; },
  };
  context.window = context;
  context.self = context;
  return context;
}

test('production content-script bundle boots without Node globals or a Vite dev server', () => {
  const source = readFileSync(new URL('../src/vendor/amll-player/player.js', import.meta.url), 'utf8');
  const context = browserContext();
  assert.equal('process' in context, false);
  try {
    vm.runInNewContext(source, context, { filename: 'amll-player.js', timeout: 5000 });
  } catch (error) {
    // Keep failures readable instead of printing a full minified source line.
    throw new Error(`Browser bundle failed to start: ${error.message}`);
  }
  assert.equal(typeof context.LyPlusAMLL?.createPlayer, 'function');
});
