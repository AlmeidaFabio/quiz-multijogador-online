import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { roomConfig } from '../config.ts';
import type { RoomRuntime } from '../rooms/runtime.ts';
import { removeRoomCreationRequest, withLockedRoom, withSharedLock } from '../shared-store.ts';
import { registerGameHandlers } from './game-handlers.ts';
import { registerRoomHandlers } from './room-handlers.ts';
import { playerForSocket } from './shared.ts';

export function registerSocketHandlers(io: Server, runtime: RoomRuntime, logger: FastifyBaseLogger): void {
  io.on('connection', (socket) => {
    registerRoomHandlers(io, socket, runtime);
    registerGameHandlers(io, socket, runtime);

    socket.on('disconnect', () => {
      const requestId = socket.data.roomQueueId as string | undefined;
      if (requestId) {
        void withSharedLock('rooms:create', async () => removeRoomCreationRequest(requestId))
          .then(async () => {
            await runtime.emitRoomQueuePositions();
            await runtime.processRoomCreationQueue();
          })
          .catch((error: unknown) => logger.error({ err: error }, 'Failed to remove disconnected user from room creation queue'));
      }
      const roomCode = socket.data.roomCode as string | undefined;
      if (!roomCode) {
        return;
      }
      void withLockedRoom(roomCode, (room) => {
        const player = room && playerForSocket(room, socket);
        if (!room || !player || player.socketId !== socket.id) {
          return;
        }
        player.connected = false;
        player.socketId = null;
        player.disconnectExpiresAt = Date.now() + roomConfig.playerReconnectGraceMs;
        runtime.emitRoomRoster(room);
        io.to(room.code).emit('room:notice', `${player.nickname} perdeu a conexão. A vaga será mantida por 60 segundos.`);
        runtime.schedulePlayerRemoval(room, player);
      }).catch((error: unknown) => logger.error({ err: error }, 'Failed to record player disconnection'));
    });
  });
}
