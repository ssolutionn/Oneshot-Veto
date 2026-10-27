import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLink, decodeLink } from '../veto-room.js';
import { readJsonBody } from '../server/veto-relay-api.js';

const original = { window: globalThis.window, document: globalThis.document };
afterEach(() => {
  if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
  if (original.document === undefined) delete globalThis.document; else globalThis.document = original.document;
});

function fakeDom() {
  const listeners = new Map();
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  globalThis.removeEventListener = name => listeners.delete(name);
  globalThis.document = {};
  return listeners;
}


test('v4 links restore assigned first-pick order', () => {
  const room = { v: 4, me: 'a', f: 'BO3', m: 5, r: 'AAAAAAAAAAAAAA', fp: ['BBBBBBBBBBBBBB', 'CCCCCCCCCCCCCC'], k: 'DDDDDDDDDDDDDDDDDDDDDD', starter: 1, t: ['Alpha', 'Bravo'] };
  const decoded = decodeLink(new URL(encodeLink('https://example.test/veto', room)).hash);
  assert.equal(decoded.v, 4);
  assert.equal(decoded.starter, 1);
  assert.equal(decoded.chooser, undefined);
  assert.deepEqual(decoded.t, room.t);
});

test('relay JSON reader cancels the body reader on parse failure', async () => {
  let cancelled = false;
  const request = new Request('https://relay.test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}'
  });
  const reader = {
    async read() { return { done: true }; },
    async cancel() { cancelled = true; }
  };
  request.body.getReader = () => reader;
  await assert.rejects(() => readJsonBody(request), SyntaxError);
  assert.equal(cancelled, true);
});

test('relay JSON reader deterministically times out when cancellation rejects the pending read', async () => {
  const oldSetTimeout = globalThis.setTimeout;
  const oldClearTimeout = globalThis.clearTimeout;
  let cancelCount = 0;
  let readRejected = false;
  let resolveReadStarted;
  const readStarted = new Promise(resolve => { resolveReadStarted = resolve; });
  globalThis.setTimeout = (fn, ms) => {
    assert.equal(ms, 8000);
    queueMicrotask(fn);
    return 1;
  };
  globalThis.clearTimeout = () => {};
  try {
    const request = new Request('https://relay.test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    request.body.getReader = () => ({
      read() {
        resolveReadStarted();
        return new Promise((_, reject) => {
          this.rejectRead = reject;
        }).catch(error => {
          readRejected = true;
          throw error;
        });
      },
      async cancel() {
        cancelCount++;
        this.rejectRead(new Error('reader cancelled'));
      }
    });

    const unhandled = [];
    const onUnhandled = error => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    try {
      const result = readJsonBody(request);
      await readStarted;
      await assert.rejects(result, error => error.message === 'timeout');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cancelCount, 1);
      assert.equal(readRejected, true);
      assert.deepEqual(unhandled, []);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  } finally {
    globalThis.setTimeout = oldSetTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  }
});
