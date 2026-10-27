import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RelayClient } from '../assets/veto-relay-client.js';

const original = {
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  document: globalThis.document,
  DateNow: Date.now
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  Date.now = original.DateNow;
});

test('a failed in-flight snapshot does not discard a newer queued snapshot', { timeout: 5000 }, async () => {
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  Date.now = () => 1_000;

  let releaseFirstPost;
  let signalFirstPostStarted;
  let signalSecondPostAccepted;
  const firstPostStarted = new Promise(resolve => { signalFirstPostStarted = resolve; });
  const secondPostAccepted = new Promise(resolve => { signalSecondPostAccepted = resolve; });
  const postedBodies = [];
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const client = new RelayClient('https://relay.example/api/veto-relay', ['abcdefghijklmn'], async () => {}, {
    interval: 25,
    publisher: { key: keyPair.privateKey, point: [exported.x, exported.y] },
    fetchImpl: async (_url, init = {}) => {
      if (init.method === 'POST') {
        postedBodies.push(JSON.parse(init.body));
        if (postedBodies.length === 1) {
          signalFirstPostStarted();
          await new Promise(resolve => { releaseFirstPost = resolve; });
          return { ok: false, status: 503 };
        }
        const result = { ok: true, status: 200, json: async () => ({ protocol: 1, accepted: true }) };
        signalSecondPostAccepted();
        return result;
      }
      return { ok: true, status: 200, json: async () => ({ protocol: 1, records: [], now: Date.now() }) };
    }
  });

  try {
    const snapshotA = { v: 1, iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAAAAAAAAAA' };
    const snapshotB = { v: 1, iv: 'BBBBBBBBBBBBBBBB', data: 'BBBBBBBBBBBBBBBBBBBBBBBB' };
    const sendA = client.send(snapshotA);
    await firstPostStarted;
    const sendB = client.send(snapshotB);
    releaseFirstPost();
    await secondPostAccepted;
    const retryDeadline = Date.now() + 1000;
    while (client.writeFailed && Date.now() < retryDeadline) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    await Promise.all([sendA, sendB]);
    assert.deepEqual(postedBodies.map(packet => packet.box), [snapshotA, snapshotB]);
    assert.equal(client.pending, null);
    assert.equal(client.writeFailed, false);
  } finally {
    client.close();
  }
});
