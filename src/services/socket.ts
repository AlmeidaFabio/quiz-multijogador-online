import { io, type Socket } from 'socket.io-client';
import type { ServerAck } from '../types.ts';

export const socket: Socket = io({ autoConnect: true });

export function getRoomCodeFromUrl(): string {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
}

export function emitWithAck(event: string, payload: unknown, timeoutMs = 5000): Promise<ServerAck> {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (timeoutError: Error | null, response: ServerAck) => {
      if (timeoutError) {
        resolve({ ok: false, message: 'O servidor não respondeu. Tente novamente.' });
        return;
      }
      resolve(response);
    });
  });
}
