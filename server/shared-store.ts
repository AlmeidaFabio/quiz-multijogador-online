import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { deserializeRoom, forgetRoom, getRoom, hasRoom, restoreRoom, roomCount, roomsForIp, serializeRoom } from './game.ts';
import { FixedWindowRateLimiter } from './rate-limit.ts';
import type { Room } from './types.ts';

const redisUrl = process.env.REDIS_URL;
const roomSetKey = 'quiz:rooms';
const localLocks = new Map<string, Promise<void>>();
const localReleases = new Map<string, () => void>();
let redis: Redis | null = null;
let publisher: Redis | null = null;
let subscriber: Redis | null = null;
const localRateLimiter = new FixedWindowRateLimiter();
const localRoomCreationQueue: RoomCreationRequest[] = [];

export interface RoomCreationRequest {
  id: string;
  socketId: string;
  creatorIp: string;
  input: unknown;
  queuedAt: number;
}

function ipSetKey(ip: string): string {
  return `quiz:rooms:ip:${Buffer.from(ip).toString('base64url')}`;
}

async function acquireRedisLock(key: string, token: string): Promise<void> {
  if (!redis) {
    const previous = localLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    localLocks.set(key, tail);
    await previous;
    localReleases.set(token, () => {
      release();
      if (localLocks.get(key) === tail) {
        localLocks.delete(key);
      }
    });
    return;
  }

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await redis.set(`quiz:lock:${key}`, token, 'PX', 30_000, 'NX') === 'OK') {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out acquiring shared lock for ${key}.`);
}

async function releaseRedisLock(key: string, token: string): Promise<void> {
  if (!redis) {
    localReleases.get(token)?.();
    localReleases.delete(token);
    return;
  }
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    `quiz:lock:${key}`,
    token
  );
}

export async function withSharedLock<T>(key: string, callback: () => Promise<T> | T): Promise<T> {
  const token = `${process.pid}:${Date.now()}:${Math.random()}`;
  await acquireRedisLock(key, token);
  let renewTimer: NodeJS.Timeout | null = null;
  if (redis) {
    renewTimer = setInterval(() => {
      void redis?.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], 30000) else return 0 end",
        1,
        `quiz:lock:${key}`,
        token
      ).catch((error: unknown) => console.error('Failed to renew Redis lock:', error));
    }, 10_000);
  }
  try {
    return await callback();
  } finally {
    if (renewTimer) {
      clearInterval(renewTimer);
    }
    await releaseRedisLock(key, token);
  }
}

export async function initializeSharedStore(io: Server): Promise<void> {
  if (!redisUrl) {
    return;
  }
  redis = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  publisher = redis.duplicate();
  subscriber = redis.duplicate();
  redis.on('error', (error) => console.error('Redis room-store error:', error));
  publisher.on('error', (error) => console.error('Redis Socket.IO publisher error:', error));
  subscriber.on('error', (error) => console.error('Redis Socket.IO subscriber error:', error));
  await Promise.all([redis.connect(), publisher.connect(), subscriber.connect()]);
  io.adapter(createAdapter(publisher, subscriber));
}

export async function consumeSharedRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  if (!redis) {
    return localRateLimiter.consume(key, limit, windowMs);
  }
  const [count, ttl] = await redis.eval(
    "local count = redis.call('incr', KEYS[1]); if count == 1 then redis.call('pexpire', KEYS[1], ARGV[1]); end; return {count, redis.call('pttl', KEYS[1])}",
    1,
    `quiz:rate:${key}`,
    windowMs
  ) as [number, number];
  return count <= limit
    ? { allowed: true, retryAfterMs: 0 }
    : { allowed: false, retryAfterMs: Math.max(0, ttl) };
}

export async function sharedStoreHealth(): Promise<'ok' | 'disabled' | 'error'> {
  if (!redis) {
    return 'disabled';
  }
  try {
    return (await redis.ping()) === 'PONG' ? 'ok' : 'error';
  } catch (error) {
    console.error('Redis health check failed:', error);
    return 'error';
  }
}

export async function saveSharedRoom(room: Room): Promise<void> {
  if (!redis) {
    return;
  }
  const pipeline = redis.multi();
  pipeline.set(`quiz:room:${room.code}`, serializeRoom(room));
  pipeline.sadd(roomSetKey, room.code);
  pipeline.sadd(ipSetKey(room.creatorIp), room.code);
  const results = await pipeline.exec();
  for (const [error] of results ?? []) {
    if (error) {
      throw error;
    }
  }
}

export async function readSharedRoom(code: string): Promise<Room | undefined> {
  if (!redis) {
    return getRoom(code);
  }
  const serialized = await redis.get(`quiz:room:${code}`);
  if (!serialized) {
    forgetRoom(code);
    return undefined;
  }
  const room = deserializeRoom(serialized);
  restoreRoom(room);
  return room;
}

export async function deleteSharedRoom(code: string): Promise<void> {
  if (!redis) {
    return;
  }
  const serialized = await redis.get(`quiz:room:${code}`);
  const pipeline = redis.multi();
  pipeline.del(`quiz:room:${code}`);
  pipeline.srem(roomSetKey, code);
  if (serialized) {
    pipeline.srem(ipSetKey(deserializeRoom(serialized).creatorIp), code);
  }
  const results = await pipeline.exec();
  for (const [error] of results ?? []) {
    if (error) {
      throw error;
    }
  }
}

export async function listSharedRooms(): Promise<Room[]> {
  if (!redis) {
    return [];
  }
  const codes = await redis.smembers(roomSetKey);
  if (codes.length === 0) {
    return [];
  }
  const values = await redis.mget(...codes.map((code) => `quiz:room:${code}`));
  const rooms: Room[] = [];
  for (const [index, serialized] of values.entries()) {
    const code = codes[index];
    if (code && serialized) {
      const room = deserializeRoom(serialized);
      restoreRoom(room);
      rooms.push(room);
    } else if (code) {
      forgetRoom(code);
    }
  }
  return rooms;
}

export async function sharedRoomCounts(ip: string): Promise<{ total: number; forIp: number }> {
  if (!redis) {
    return { total: roomCount(), forIp: roomsForIp(ip) };
  }
  const [total, forIp] = await Promise.all([
    redis.scard(roomSetKey),
    redis.scard(ipSetKey(ip))
  ]);
  return { total, forIp };
}

export async function roomCreationQueue(): Promise<RoomCreationRequest[]> {
  if (!redis) {
    return [...localRoomCreationQueue];
  }
  const ids = await redis.lrange('quiz:room-creation-queue', 0, -1);
  if (ids.length === 0) {
    return [];
  }
  const entries = await redis.hmget('quiz:room-creation-queue:entries', ...ids);
  return entries.flatMap((serialized) => serialized ? [JSON.parse(serialized) as RoomCreationRequest] : []);
}

export async function enqueueRoomCreation(
  request: RoomCreationRequest,
  maxQueueSize: number
): Promise<{ position: number; total: number } | null> {
  const current = await roomCreationQueue();
  const existing = current.findIndex((entry) => entry.socketId === request.socketId);
  if (existing >= 0) {
    return { position: existing + 1, total: current.length };
  }
  if (current.length >= maxQueueSize) {
    return null;
  }
  if (!redis) {
    localRoomCreationQueue.push(request);
  } else {
    const pipeline = redis.multi();
    pipeline.rpush('quiz:room-creation-queue', request.id);
    pipeline.hset('quiz:room-creation-queue:entries', request.id, JSON.stringify(request));
    const results = await pipeline.exec();
    for (const [error] of results ?? []) {
      if (error) {
        throw error;
      }
    }
  }
  const updated = await roomCreationQueue();
  const position = updated.findIndex((entry) => entry.id === request.id) + 1;
  return { position, total: updated.length };
}

export async function removeRoomCreationRequest(id: string): Promise<boolean> {
  if (!redis) {
    const index = localRoomCreationQueue.findIndex((request) => request.id === id);
    if (index < 0) {
      return false;
    }
    localRoomCreationQueue.splice(index, 1);
    return true;
  }
  const pipeline = redis.multi();
  pipeline.lrem('quiz:room-creation-queue', 1, id);
  pipeline.hdel('quiz:room-creation-queue:entries', id);
  const results = await pipeline.exec();
  for (const [error] of results ?? []) {
    if (error) {
      throw error;
    }
  }
  return Number(results?.[0]?.[1] ?? 0) > 0;
}

export async function withLockedRoom<T>(
  code: string,
  callback: (room: Room | undefined) => Promise<T> | T
): Promise<T> {
  const normalizedCode = typeof code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/iu.test(code)
    ? code.toUpperCase()
    : null;
  if (!normalizedCode) {
    return callback(undefined);
  }
  return withSharedLock(`room:${normalizedCode}`, async () => {
    const room = await readSharedRoom(normalizedCode);
    try {
      return await callback(room);
    } finally {
      if (room && hasRoom(normalizedCode)) {
        await saveSharedRoom(room);
      } else if (room) {
        await deleteSharedRoom(normalizedCode);
      }
    }
  });
}

export async function restoreSharedRooms(): Promise<Room[]> {
  return listSharedRooms();
}

export async function closeSharedStore(): Promise<void> {
  await Promise.all([redis, publisher, subscriber].filter((client): client is Redis => client !== null)
    .map((client) => client.quit()));
  redis = null;
  publisher = null;
  subscriber = null;
}
