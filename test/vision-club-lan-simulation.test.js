import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RelayClient } from '../assets/veto-relay-client.js';
import { relayTopic } from '../assets/veto-relay-protocol.js';
import { FileRelayStore } from '../server/veto-relay-file.js';
import { relayServer } from '../server/veto-relay-node.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const box = char => ({ v: 1, iv: char.repeat(16), data: char.repeat(24) });

async function captainIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const point = [jwk.x, jwk.y];
  return { key: pair.privateKey, point, topic: await relayTopic(point) };
}

test('Vision Club LAN scenario: concurrent captains recover through local Node relay', { timeout: 8000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'veto-vision-lan-'));
  const store = new FileRelayStore(directory);
  const server = relayServer(store);
  let clientA;
  let clientB;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const endpoint = `http://127.0.0.1:${address.port}/api/veto-relay`;
    const a = await captainIdentity();
    const b = await captainIdentity();
    assert.notEqual(a.topic, b.topic);

    const received = { a: null, b: null };
    let resolveA;
    let resolveB;
    const sawA = new Promise(resolve => { resolveA = resolve; });
    const sawB = new Promise(resolve => { resolveB = resolve; });
    const postCount = { a: 0, b: 0 };
    const topics = [a.topic, b.topic];

    const buildClient = (identity, seat, delayMs, dropFirstPost) => new RelayClient(
      endpoint, topics,
      async (_encryptedSnapshot, topic, fresh) => {
        if (!fresh || topic === identity.topic) return;
        received[seat] = topic;
        if (seat === 'a') resolveA();
        else resolveB();
      },
      {
        interval: 20,
        publisher: { key: identity.key, point: identity.point },
        fetchImpl: async (url, init = {}) => {
          if (init.method === 'POST') {
            postCount[seat]++;
            await delay(delayMs);
            if (dropFirstPost && postCount[seat] === 1) return new Response('{}', { status: 503 });
          }
          return fetch(url, init);
        }
      }
    );

    clientA = buildClient(a, 'a', 55, true);
    clientB = buildClient(b, 'b', 5, false);
    await Promise.all([clientA.send(box('A')), clientB.send(box('B')), sawA, sawB]);
    assert.equal(received.a, b.topic);
    assert.equal(received.b, a.topic);
    assert.equal(postCount.a, 2, 'first A publish was lost and bounded retry delivered it');
    assert.equal(postCount.b, 1);
    assert.equal((await store.read(a.topic)).packet.topic, a.topic);
    assert.equal((await store.read(b.topic)).packet.topic, b.topic);
  } finally {
    clientA?.close();
    clientB?.close();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
