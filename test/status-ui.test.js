import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RelayClient } from '../assets/veto-relay-client.js';
import { ServerRoomLink } from '../assets/veto-relay-links.js';
import { statusView, statusStates, STATUS_BASE_CLASS } from '../assets/veto-status.js';

const original = {
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  document: globalThis.document,
  fetch: globalThis.fetch,
  DateNow: Date.now
};

afterEach(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[key];
    else globalThis[key] = value;
  }
  Date.now = original.DateNow;
});

function browserStubs(fetchImpl) {
  const listeners = new Map();
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  globalThis.removeEventListener = name => listeners.delete(name);
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  // ServerRoomLink cannot take a fetchImpl: its poll must be stubbed globally
  // or it hits the real network and hangs the test process.
  globalThis.fetch = fetchImpl || relayFetch();
  return listeners;
}

function relayFetch(records = []) {
  return async (_url, init = {}) => {
    if (init.method === 'POST') return { ok: true, status: 200, json: async () => ({ protocol: 1, accepted: true }) };
    return { ok: true, status: 200, json: async () => ({ protocol: 1, records, now: Date.now() }) };
  };
}

const BOX = { v: 1, iv: 'A'.repeat(16), data: 'A'.repeat(24) };

async function roomFixture() {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    me: 'a', relay: 'https://relay.example/api/veto-relay',
    fp: ['abcdefghijklmn', 'opqrstuvwxyzab'],
    p: [[jwk.x, jwk.y], null],
    key, privateKey: pair.privateKey
  };
}

test('all five states map with their own textKey and className', () => {
  assert.deepEqual(new Set(statusStates()), new Set([
    'serverOnline', 'serverRetry', 'serverWait', 'vdoConnection', 'browserOffline',
  ]));
  const expected = {
    serverOnline: { textKey: 'serverOnline', className: 'vt-status--online' },
    serverRetry: { textKey: 'serverRetry', className: 'vt-status--retry' },
    serverWait: { textKey: 'serverWait', className: 'vt-status--wait' },
    vdoConnection: { textKey: 'vdoConnection', className: 'vt-status--neutral' },
    browserOffline: { textKey: 'browserOffline', className: 'vt-status--offline' },
  };
  for (const state of statusStates()) {
    assert.deepEqual(statusView(state), expected[state], `${state} must map exactly`);
  }
  assert.equal(STATUS_BASE_CLASS, 'vt-status');
});

test('unknown states map to null; the page fallback view is vdoConnection', () => {
  assert.equal(statusView('nope'), null);
  assert.equal(statusView(''), null);
  assert.equal(statusView('serveronline'), null); // case matters
  // The page's expression: an unknown state must fall back, never blank the strip.
  assert.equal((statusView('garbage') || statusView('vdoConnection')).className, 'vt-status--neutral');
});

test('RelayClient status callback maps to online/retry views the way the page does', () => {
  const toView = status => statusView(status === 'online' ? 'serverOnline' : 'serverRetry');
  assert.equal(toView('online').className, 'vt-status--online');
  assert.equal(toView('retry').className, 'vt-status--retry');
  assert.equal(toView('online').className, 'vt-status--online');
});

test('ServerRoomLink.unsent: false while idle, true after a failed POST, false when accepted', async () => {
  let accepted = true;
  browserStubs(async (_url, init = {}) => {
    if (init.method === 'POST' && !accepted) return { ok: false, status: 503, json: async () => ({}) };
    return relayFetch()(_url, init);
  });
  const room = await roomFixture();
  const link = new ServerRoomLink(room, { key: room.key, streams: ['s0', 's1'] }, room.privateKey,
    async () => {}, () => {});
  try {
    assert.equal(link.unsent, false, 'idle link reports nothing unsent');
    assert.equal(link.sending, false, 'idle link reports not sending');
    // Drive one failed publish end to end through the real send path.
    accepted = false;
    await link.send(BOX);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(link.unsent, true, 'queued packet after a failed POST shows unsent');
    accepted = true;
    // A successful retry clears the badge state.
    const cleared = await link.send(BOX);
    assert.equal(cleared, true);
    assert.equal(link.unsent, false, 'accepted publish clears unsent');
  } finally {
    link.close();
  }
});

test('ServerRoomLink.unsent stays false during a live retry attempt (anti-flicker contract)', async () => {
  let releasePost;
  let postStarted;
  const postBegun = new Promise(resolve => { postStarted = resolve; });
  browserStubs(async (_url, init = {}) => {
    if (init.method === 'POST') {
      postStarted();
      await new Promise(resolve => { releasePost = resolve; });
      return { ok: false, status: 503, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ protocol: 1, records: [], now: Date.now() }) };
  });
  const room = await roomFixture();
  const link = new ServerRoomLink(room, { key: room.key, streams: ['s0', 's1'] }, room.privateKey,
    async () => {}, () => {});
  try {
    const attempt = link.send(BOX);
    await postBegun;
    assert.equal(link.sending, true, 'attempt in flight reports sending');
    assert.equal(link.unsent, false, 'pending is null during the attempt; the page keeps the badge via sending');
    releasePost();
    await attempt;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(link.unsent, true, 'failed attempt re-queues and reports unsent');
  } finally {
    releasePost?.();
    link.close();
  }
});

test('browserOffline override: it maps like any other state and outranks transport', () => {
  const fallback = statusView('browserOffline');
  assert.deepEqual(fallback, { textKey: 'browserOffline', className: 'vt-status--offline' });
  const shown = statusView('browserOffline') || statusView('serverOnline');
  assert.equal(shown.className, 'vt-status--offline');
});

test('poll failure then recovery drive the same status transitions the strip renders', async () => {
  browserStubs();
  const statuses = [];
  let failNext = true;
  const client = new RelayClient('https://relay.example/api/veto-relay', ['abcdefghijklmn'], async () => {}, {
    interval: 5,
    onStatus: status => statuses.push(status),
    fetchImpl: async () => {
      if (failNext) { failNext = false; throw Error('network'); }
      return { ok: true, status: 200, json: async () => ({ protocol: 1, records: [], now: Date.now() }) };
    }
  });
  try {
    await client.poll();
    const deadline = Date.now() + 1000;
    while (!statuses.includes('online') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.ok(statuses.includes('retry'), 'a failed poll reports retry');
    assert.ok(statuses.includes('online'), 'a recovered poll reports online');
  } finally {
    client.close();
  }
});
