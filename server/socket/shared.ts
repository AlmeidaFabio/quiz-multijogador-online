import type { Socket } from 'socket.io';
import { rateLimitConfig } from '../config.ts';
import { consumeSharedRateLimit } from '../shared-store.ts';
import type { Room } from '../types.ts';

export type Ack<T = object> = (result:
  | ({ ok: true } & T)
  | { ok: false; message: string; errorCode?: string; position?: number; total?: number }
) => void;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function requestIp(socket: Socket): string {
  return socket.handshake.address || 'unknown';
}

export function playerForSocket(room: Room, socket: Socket) {
  const playerId = socket.data.playerId as string | undefined;
  return playerId ? room.players.get(playerId) : undefined;
}

export async function allowSocketAction(socket: Socket, action: string, limit: number, ack?: Ack): Promise<boolean> {
  const key = `${action}:${socket.handshake.address || 'unknown'}`;
  const result = await consumeSharedRateLimit(key, limit, rateLimitConfig.windowMs);
  if (result.allowed) {
    return true;
  }
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  ack?.({ ok: false, message: `Muitas tentativas. Aguarde ${seconds} segundo(s) e tente novamente.` });
  return false;
}
