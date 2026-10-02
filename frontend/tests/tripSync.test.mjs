// Exercise revocation races with real session logic and manually controlled HTTP responses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './load-ts.mjs';
const { TripSyncSession } = await loadTs(new URL('../src/tripSync.ts', import.meta.url));
const { ApiError } = await loadTs(new URL('../src/api.ts', import.meta.url));
const snapshot = (version = 1) => ({ id: 'shared-trip', version });
const payload = (version = 1) => ({ snapshot: snapshot(version), events: [{ version }] });
function harness() {
  const pending = [], snapshots = [], events = [], errors = [], losses = [];
  const session = new TripSyncSession('shared-trip', {
    fetch: version => new Promise((resolve, reject) => pending.push({ version, resolve, reject })),
    onSnapshot: value => snapshots.push(value), onEvents: value => events.push(value),
    onError: value => errors.push(value), onUnavailable: reason => losses.push(reason),
  });
  return { session, pending, snapshots, events, errors, losses };
}

for (const status of [401, 403, 404]) test(`sync HTTP ${status} evicts access and rejects late snapshots`, async () => {
  const h = harness();
  h.session.accept(snapshot());
  const oldRequest = h.session.refresh(), deniedRequest = h.session.refresh();
  h.pending[1].reject(new ApiError('Unavailable', status));
  await deniedRequest;
  assert.equal(h.session.active, false);
  assert.deepEqual(h.losses, [status === 401 ? 'session' : 'access']);
  h.pending[0].resolve(payload(2));
  await oldRequest;
  h.session.accept(snapshot(3));
  await h.session.refresh();
  assert.deepEqual(h.snapshots, [snapshot()]);
  assert.deepEqual(h.events, []);
  assert.equal(h.pending.length, 2);
});

test('policy close evicts immediately, even if the pending HTTP request never finishes', async () => {
  const h = harness();
  const pending = h.session.refresh();
  h.session.revoke();
  h.session.revoke();
  assert.deepEqual(h.losses, ['access']);
  h.pending[0].resolve(payload());
  await pending;
  assert.deepEqual(h.snapshots, []);
});

test('voluntary leave discards in-flight snapshots and ignores subsequent policy closes', async () => {
  const h = harness();
  h.session.accept(snapshot());
  const pending = h.session.refresh();
  h.session.revoke('left');
  h.session.revoke();
  h.pending[0].resolve(payload(2));
  await pending;
  assert.deepEqual(h.losses, ['left']);
  assert.deepEqual(h.snapshots, [snapshot()]);
  assert.deepEqual(h.events, []);
});

test('stopping a previous trip ignores its late error without evicting the new selection', async () => {
  const h = harness();
  const pending = h.session.refresh();
  h.session.stop();
  h.pending[0].reject(new ApiError('Trip not found.', 404));
  await pending;
  assert.deepEqual(h.losses, []);
  assert.deepEqual(h.errors, []);
});

for (const error of [new TypeError('Failed to fetch'), new ApiError('Server error', 500)]) {
  test(`${error.message} preserves access and allows recovery`, async () => {
    const h = harness();
    h.session.accept(snapshot());
    const failed = h.session.refresh();
    h.pending[0].reject(error);
    await failed;
    assert.equal(h.session.active, true);
    assert.deepEqual(h.losses, []);
    assert.deepEqual(h.errors, [error.message]);
    const retry = h.session.refresh();
    h.pending[1].resolve(payload(2));
    await retry;
    assert.equal(h.snapshots.at(-1).version, 2);
    assert.equal(h.errors.at(-1), '');
  });
}

test('older snapshots and responses for another trip cannot overwrite the current plan', async () => {
  const h = harness();
  h.session.accept(snapshot(3));
  h.session.accept(snapshot(2));
  h.session.accept({ id: 'another-trip', version: 100 });
  const next = h.session.refresh();
  assert.equal(h.pending[0].version, 3);
  h.pending[0].resolve(payload(4));
  await next;
  assert.deepEqual(h.snapshots.map(value => value.version), [3, 4]);
});
