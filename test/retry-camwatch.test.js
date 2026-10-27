import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RelayClient } from '../assets/veto-relay-client.js';
import { CamWatch } from '../vdo.js';

const original = {
  fetch: globalThis.fetch,
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  document: globalThis.document,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  DateNow: Date.now
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  Date.now = original.DateNow;
});

function fakeTimers(start = 1_000_000) {
  let now = start, nextId = 1;
  const timers = new Map();
  Date.now = () => now;
  globalThis.setTimeout = (fn, delay = 0) => {
    const id = nextId++;
    timers.set(id, { fn, at: now + delay });
    return id;
  };
  globalThis.clearTimeout = id => timers.delete(id);
  return {
    async advance(ms) {
      const end = now + ms;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.fn();
        await flush();
      }
      now = end;
      await flush();
    },
    count: () => timers.size
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function browserStubs() {
  const listeners = new Map();
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  globalThis.removeEventListener = name => listeners.delete(name);
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener() {},
    removeEventListener() {},
    createElement() {
      return {
        contentWindow: { sent: [], postMessage(data, origin) { this.sent.push({ data, origin }); } },
        setAttribute() {}, remove() {},
        set src(value) { this.url = value; }, get src() { return this.url; }
      };
    },
    body: { append() {} }
  };
  return listeners;
}

const topic = 'abcdefghijklmn';
const endpoint = 'https://relay.example/api/veto-relay';

test('RelayClient retries a failed POST after bounded backoff and clears pending state on acceptance', async () => {
  const clock = fakeTimers();
  browserStubs();
  const posts = [];
  let resolveSecondAccepted;
  const secondAccepted = new Promise(resolve => { resolveSecondAccepted = resolve; });
  const keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const point = [exported.x, exported.y];
  const client = new RelayClient(endpoint, [topic], async () => {}, {
    interval: 100,
    publisher: { key: keyPair.privateKey, point },
    fetchImpl: async (_url, init) => {
      if (init.method === 'POST') {
        posts.push(init);
        if (posts.length === 1) return { ok: false, status: 503 };
        const response = { ok: true, status: 200, json: async () => ({ protocol: 1, accepted: true }) };
        resolveSecondAccepted();
        return response;
      }
      return { ok: true, status: 200, json: async () => ({ protocol: 1, records: [], now: Date.now() }) };
    }
  });
  const box = { v: 1, iv: 'AAAAAAAAAAAAAAAA', data: 'AAAAAAAAAAAAAAAAAAAAAAAA' };
  const first = client.send(box);
  await first;
  await flush();
  assert.equal(posts.length, 1);
  assert.equal(client.writeFailed, true);
  assert.deepEqual(client.pending, box);
  assert.ok(clock.count() >= 1, 'failed POST schedules a bounded retry timer');
  await clock.advance(500);
  await secondAccepted;
  await flush();
  assert.equal(posts.length, 2, 'retry runs automatically within the bounded backoff window');
  await flush();
  await first;
  assert.equal(posts.length, 2);
  assert.equal(client.pending, null);
  assert.equal(client.writeFailed, false);
  client.close();
});

test('RelayClient coalesces poll wakes while one poll request is in flight', async () => {
  fakeTimers();
  const listeners = browserStubs();
  let resolveFetch;
  let calls = 0;
  const client = new RelayClient(endpoint, [topic], async () => {}, {
    interval: 100,
    fetchImpl: () => { calls++; return new Promise(resolve => { resolveFetch = resolve; }); }
  });
  assert.equal(calls, 1);
  await client.poll();
  listeners.get('online')();
  listeners.get('pageshow')();
  assert.equal(calls, 1, 'concurrent wake requests do not start parallel polls');
  resolveFetch({ ok: true, json: async () => ({ protocol: 1, records: [], now: Date.now() }) });
  await flush();
  assert.equal(calls, 2, 'multiple wakes coalesce into one immediate follow-up poll');
  client.close();
  resolveFetch({ ok: true, json: async () => ({ protocol: 1, records: [], now: Date.now() }) });
});

test('CamWatch TTL expires live status until a fresh stream response arrives', () => {
  const clock = fakeTimers();
  browserStubs();
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  const changes = [];
  const watch = new CamWatch((live, checking) => changes.push({ live: [...live], checking: [...checking] }), 4000, 12000);
  watch.watch([{ room: 'team-room', ids: ['camera-a'] }]);
  const entry = [...watch.rooms.values()][0];
  const response = { source: entry.iframe.contentWindow, origin: 'https://vdo.ninja', data: { streamIDs: { 'camera-a': true } } };
  watch.receive(response);
  assert.deepEqual(changes.at(-1), { live: ['camera-a'], checking: [] });
  clock.advance(11999);
  watch.update();
  assert.deepEqual(changes.at(-1), { live: ['camera-a'], checking: [] });
  clock.advance(1);
  watch.update();
  assert.deepEqual(changes.at(-1), { live: [], checking: ['camera-a'] });
  watch.receive(response);
  assert.deepEqual(changes.at(-1), { live: ['camera-a'], checking: [] });
  watch.stop();
});
