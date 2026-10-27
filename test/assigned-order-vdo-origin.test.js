import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeLink, decodeLink, restartRoom } from '../veto-room.js';
import { CamWatch, VdoLink } from '../vdo.js';

const original = {
  addEventListener: globalThis.addEventListener,
  removeEventListener: globalThis.removeEventListener,
  document: globalThis.document,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval
};

afterEach(() => {
  for (const key of Object.keys(original)) {
    if (original[key] === undefined) delete globalThis[key];
    else globalThis[key] = original[key];
  }
});

function room(version, assigned) {
  return {
    v: version, me: 'a', f: 'BO3', m: 5, r: 'AAAAAAAAAAAAAA',
    fp: ['BBBBBBBBBBBBBB', 'CCCCCCCCCCCCCC'], k: 'DDDDDDDDDDDDDDDDDDDDDD',
    ...(version === 3 ? { chooser: assigned } : { starter: assigned }), t: ['Alpha', 'Bravo']
  };
}

test('v4 assigned first pick survives encoding and decoding', () => {
  const decoded = decodeLink(new URL(encodeLink('https://example.test/veto', room(4, 1))).hash);
  assert.equal(decoded.v, 4);
  assert.equal(decoded.starter, 1);
  assert.equal(decoded.chooser, undefined);
});

test('legacy v3 chooser is preserved when links are restarted', async () => {
  const prior = room(3, 0);
  const made = await restartRoom('https://example.test/veto', prior);
  assert.equal(made.room.v, 3);
  assert.equal(made.room.chooser, 0);
  assert.equal(made.room.starter, undefined);
  for (const link of Object.values(made.links)) {
    const decoded = decodeLink(new URL(link).hash);
    assert.equal(decoded.v, 3);
    assert.equal(decoded.chooser, 0);
    assert.equal(decoded.starter, undefined);
  }
});

function fakeDocument(frames) {
  return {
    createElement() {
      return {
        contentWindow: { sent: [] },
        setAttribute() {}, remove() {},
        set src(value) { this.url = value; },
        get src() { return this.url; },
        get sent() { return this.contentWindow.sent; }
      };
    },
    body: { append(frame) { frame.contentWindow.postMessage = (data, origin) => frame.sent.push({ data, origin }); frames.push(frame); } }
  };
}

test('VdoLink rejects unexpected origins and targets VDO exactly', async () => {
  const listeners = new Map(), frames = [];
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  globalThis.removeEventListener = name => listeners.delete(name);
  globalThis.document = fakeDocument(frames);
  const key = await globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const link = new VdoLink({ stream: 'stream', password: 'password', key }, 'dock', () => {});
  const frame = frames[0], source = frame.contentWindow;
  const event = { source, data: { action: 'push-connection', UUID: 'peer' } };
  link.receive({ ...event, origin: 'https://attacker.example' });
  assert.equal(link.peers.size, 0);
  link.receive({ ...event, origin: 'https://cdn-backup.vdo.ninja' });
  assert.deepEqual([...link.peers], ['peer']);
  await link.send({ type: 'test' });
  assert.ok(frame.sent.every(call => call.origin === 'https://vdo.ninja'));
  link.close();
});

test('CamWatch rejects unexpected origins and targets VDO exactly', () => {
  const listeners = new Map(), frames = [];
  globalThis.addEventListener = (name, fn) => listeners.set(name, fn);
  globalThis.removeEventListener = name => listeners.delete(name);
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};
  globalThis.document = fakeDocument(frames);
  const changes = [];
  const watch = new CamWatch(live => changes.push([...live]), 60_000);
  watch.watch([{ room: 'room', ids: ['camera'] }]);
  const entry = [...watch.rooms.values()][0];
  const source = entry.iframe.contentWindow;
  watch.receive({ source, origin: 'https://attacker.example', data: { streamIDs: { camera: true } } });
  assert.deepEqual([...entry.live], []);
  watch.receive({ source, origin: 'https://vdo.ninja', data: { streamIDs: { camera: true } } });
  assert.deepEqual([...entry.live], ['camera']);
  watch.poll();
  assert.ok(entry.iframe.sent.every(call => call.origin === 'https://vdo.ninja'));
  watch.stop();
});
