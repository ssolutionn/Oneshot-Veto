import test from 'node:test';
import assert from 'node:assert/strict';
import { readJsonBody } from '../server/veto-relay-api.js';

test('relay JSON reader times out promptly when cancel rejects and read never settles', async () => {
  const oldSetTimeout = globalThis.setTimeout;
  const oldClearTimeout = globalThis.clearTimeout;
  let cancelCount = 0;
  let resolveReadStarted;
  const readStarted = new Promise(resolve => { resolveReadStarted = resolve; });
  globalThis.setTimeout = (fn, ms) => {
    assert.equal(ms, 8000);
    queueMicrotask(fn);
    return 1;
  };
  globalThis.clearTimeout = () => {};

  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const request = new Request('https://relay.test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    request.body.getReader = () => ({
      read() {
        resolveReadStarted();
        return new Promise(() => {});
      },
      cancel() {
        cancelCount++;
        return Promise.reject(new Error('cancel failed'));
      }
    });

    const result = readJsonBody(request);
    await readStarted;
    await assert.rejects(result, error => error.message === 'timeout');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(cancelCount, 1);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    globalThis.setTimeout = oldSetTimeout;
    globalThis.clearTimeout = oldClearTimeout;
  }
});
