import test from 'node:test';
import assert from 'node:assert/strict';
import { CamWatch } from '../vdo.js';

const original = {
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  document: globalThis.document,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  DateNow: Date.now
};

test.afterEach(() => {
  globalThis.addEventListener = original.addEventListener;
  globalThis.removeEventListener = original.removeEventListener;
  globalThis.document = original.document;
  globalThis.setInterval = original.setInterval;
  globalThis.clearInterval = original.clearInterval;
  globalThis.setTimeout = original.setTimeout;
  globalThis.clearTimeout = original.clearTimeout;
  Date.now = original.DateNow;
});

function installClock(start = 1_000_000) {
  let now = start, nextId = 1;
  const timers = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay) => { const id = nextId++; timers.set(id, { fn, at: now + delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  return {
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    }
  };
}

function installDom() {
  const listeners = new Map(), frames = [];
  globalThis.addEventListener = (type, fn) => listeners.set(type, fn);
  globalThis.removeEventListener = type => listeners.delete(type);
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  globalThis.document = {
    createElement() {
      const contentWindow = { messages: [], postMessage(data, origin) { this.messages.push({ data, origin }); } };
      return { contentWindow, setAttribute() {}, remove() {}, set src(v) { this.url = v; }, get src() { return this.url; } };
    },
    body: { append(frame) { frames.push(frame); } }
  };
  return { listeners, frames };
}

test('CamWatch expires live status when stream responses stop and recovers on response', () => {
  const clock = installClock(), { frames } = installDom(), changes = [];
  const watch = new CamWatch((live, checking) => changes.push({ live: [...live], checking: [...checking] }), 4000, 12000);
  watch.watch([{ room: 'team-room', ids: ['camera-a'] }]);
  const entry = [...watch.rooms.values()][0];
  watch.receive({ source: entry.iframe.contentWindow, origin: 'https://vdo.ninja', data: { streamIDs: { 'camera-a': true } } });
  assert.deepEqual(changes.at(-1), { live: ['camera-a'], checking: [] });
  clock.advance(12000);
  watch.update();
  assert.deepEqual(changes.at(-1), { live: [], checking: ['camera-a'] });
  watch.receive({ source: entry.iframe.contentWindow, origin: 'https://vdo.ninja', data: { streamIDs: { 'camera-a': true } } });
  assert.deepEqual(changes.at(-1), { live: ['camera-a'], checking: [] });
  watch.stop();
  assert.equal(frames[0].removed || false, false);
});
