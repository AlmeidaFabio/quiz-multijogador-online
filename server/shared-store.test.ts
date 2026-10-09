import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enqueueRoomCreation,
  removeRoomCreationRequest,
  roomCreationQueue,
  withSharedLock
} from './shared-store.ts';

test('keeps room creation requests in FIFO order and enforces the queue capacity', async () => {
  const first = { id: 'queue-test-1', socketId: 'socket-test-1', creatorIp: 'test', input: {}, queuedAt: 1 };
  const second = { id: 'queue-test-2', socketId: 'socket-test-2', creatorIp: 'test', input: {}, queuedAt: 2 };
  try {
    assert.deepEqual(await enqueueRoomCreation(first, 2), { position: 1, total: 1 });
    assert.deepEqual(await enqueueRoomCreation(second, 2), { position: 2, total: 2 });
    assert.equal(await enqueueRoomCreation({
      id: 'queue-test-3',
      socketId: 'socket-test-3',
      creatorIp: 'test',
      input: {},
      queuedAt: 3
    }, 2), null);
    assert.deepEqual((await roomCreationQueue()).map((request) => request.id), [first.id, second.id]);
    assert.equal(await removeRoomCreationRequest(first.id), true);
    assert.deepEqual((await roomCreationQueue()).map((request) => request.id), [second.id]);
  } finally {
    await removeRoomCreationRequest(first.id);
    await removeRoomCreationRequest(second.id);
  }
});

test('returns the existing queue position rather than duplicating a socket request', async () => {
  const request = { id: 'queue-test-duplicate', socketId: 'socket-test-duplicate', creatorIp: 'test', input: {}, queuedAt: 1 };
  try {
    assert.deepEqual(await enqueueRoomCreation(request, 2), { position: 1, total: 1 });
    assert.deepEqual(await enqueueRoomCreation({ ...request, id: 'queue-test-duplicate-again' }, 2), { position: 1, total: 1 });
    assert.equal((await roomCreationQueue()).filter((entry) => entry.socketId === request.socketId).length, 1);
  } finally {
    await removeRoomCreationRequest(request.id);
  }
});

test('serializes concurrent operations for the same lock key', async () => {
  let active = 0;
  let maximumActive = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: 20 }, () => withSharedLock('test-room', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    completed += 1;
  })));
  assert.equal(completed, 20);
  assert.equal(maximumActive, 1);
});

test('allows unrelated lock keys to run concurrently', async () => {
  let active = 0;
  let maximumActive = 0;
  await Promise.all(['room-a', 'room-b'].map((key) => withSharedLock(key, async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  })));
  assert.equal(maximumActive, 2);
});
