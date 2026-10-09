import assert from 'node:assert/strict';
import test from 'node:test';
import { FixedWindowRateLimiter } from './rate-limit.ts';

test('allows requests up to the configured fixed-window limit', () => {
  const limiter = new FixedWindowRateLimiter();
  assert.deepEqual(limiter.consume('client-a', 2, 1000, 100), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.consume('client-a', 2, 1000, 200), { allowed: true, retryAfterMs: 0 });
  assert.deepEqual(limiter.consume('client-a', 2, 1000, 300), { allowed: false, retryAfterMs: 800 });
});

test('resets the request budget when a fixed window expires', () => {
  const limiter = new FixedWindowRateLimiter();
  limiter.consume('client-a', 1, 1000, 100);
  assert.deepEqual(limiter.consume('client-a', 1, 1000, 1100), { allowed: true, retryAfterMs: 0 });
});

test('tracks clients independently', () => {
  const limiter = new FixedWindowRateLimiter();
  limiter.consume('client-a', 1, 1000, 100);
  assert.deepEqual(limiter.consume('client-b', 1, 1000, 100), { allowed: true, retryAfterMs: 0 });
});
