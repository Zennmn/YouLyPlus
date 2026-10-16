import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const source = readFileSync(new URL('../vendor/amll/packages/core/src/lyric-player/dom/line-brightness.ts', import.meta.url), 'utf8');
const { code } = await transform(source.replace(/^import .*;\r?$/gm, ''), { loader: 'ts', format: 'cjs', target: 'es2022' });

function fixture() {
  let nextId = 0;
  const frames = new Map();
  const styles = { lyricMainLineBright: 'bright', lyricMainLineDim: 'dim' };
  class Element {
    isConnected = true;
    parentElement = null;
    children = [];
    animations = [];
    style = { transition: '', removeProperty(name) { delete this[name]; } };
    classes = new Set();
    classList = {
      contains: name => this.classes.has(name),
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
    };
    append(child) { this.children.push(child); child.parentElement = this; }
    remove() {
      this.isConnected = false;
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
    cloneNode() { const copy = new Element(); for (const name of this.classes) copy.classes.add(name); return copy; }
    setAttribute() {}
    querySelectorAll() { return []; }
    animate(keyframes, timing) {
      const animation = { keyframes, timing, canceled: false, cancel() { this.canceled = true; } };
      this.animations.push(animation);
      return animation;
    }
  }
  const context = vm.createContext({ module: { exports: {} }, styles, HTMLElement: Element,
    performance: { now: () => 1000 },
    getComputedStyle: () => ({ paddingTop: '0px', paddingLeft: '0px', paddingRight: '0px', marginTop: '0px', marginLeft: '0px', marginRight: '0px' }),
    requestAnimationFrame: callback => { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  vm.runInContext(code, context);
  const parent = new Element(), main = new Element();
  parent.append(main);
  const brightness = new context.module.exports.LineBrightness(main);
  const frame = () => {
    for (const [id, callback] of [...frames]) {
      if (!frames.delete(id)) continue;
      callback(0);
    }
  };
  return { brightness, parent, main, frame, frames, Element, LineBrightness: context.module.exports.LineBrightness };
}

test('resting layer switches stay transition-free through the first render opportunity', () => {
  const { brightness, main, parent, frame, frames } = fixture();
  brightness.sync();
  assert.equal(parent.children.length, 2);
  assert.equal(main.classList.contains('bright'), true);
  frame();
  assert.equal(main.style.transition, 'none', 'the first rAF can precede the first style commit after mount/message');
  frame();
  assert.equal(main.style.transition, '');
  assert.equal(frames.size, 0);

  brightness.setInWindow(false);
  assert.equal(parent.children.length, 1);
  assert.equal(main.classList.contains('bright'), false);
  frame();
  assert.equal(main.style.transition, 'none', 'removing the dim copy must not animate the single resting layer either');
  frame();
  assert.equal(main.style.transition, '');
});

test('repeated window switches and player disposal cancel either pending frame', () => {
  for (const framesBeforeClose of [0, 1]) {
    const { brightness, main, parent, frame, frames, Element, LineBrightness } = fixture();
    brightness.sync();
    frame();
    brightness.setInWindow(false);
    assert.equal(frames.size, 1, 'superseding switch must cancel the old restore');
    frame();
    assert.equal(main.style.transition, 'none');
    if (framesBeforeClose) frame();
    brightness.dispose();
    assert.equal(frames.size, 0);
    assert.equal(main.style.transition, '');
    assert.equal(parent.children.length, 1);
    frame();
    assert.equal(main.classList.contains('bright'), false);

    const reopenedMain = new Element();
    parent.append(reopenedMain);
    const reopened = new LineBrightness(reopenedMain);
    reopened.sync();
    if (framesBeforeClose) frame();
    reopened.dispose();
    assert.equal(frames.size, 0, 'closing a reopened player must cancel first or second frame');
    frame();
    assert.equal(reopenedMain.style.transition, '');
  }
});

test('singing activation keeps its original crossfade and is canceled when leaving highlight', () => {
  const { brightness, main, parent, frame, frames } = fixture();
  brightness.sync(); frame(); frame();
  brightness.playActivationTransition();
  const mainAnimation = main.animations[0], dimAnimation = parent.children[1].animations[0];
  assert.equal(mainAnimation.timing.duration, 300);
  assert.equal(dimAnimation.timing.duration, 300);
  assert.deepEqual(Array.from(mainAnimation.keyframes, k => k.opacity), [0, 1]);
  assert.deepEqual(Array.from(dimAnimation.keyframes, k => k.opacity), [0.2, 0]);
  assert.equal(main.style.transition, '', 'normal singing transitions remain enabled');
  brightness.markHighlightExited();
  assert.equal(mainAnimation.canceled, true);
  assert.equal(dimAnimation.canceled, true);
  assert.equal(frames.size, 0);
});
