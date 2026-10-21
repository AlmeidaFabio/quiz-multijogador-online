import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { rateLimitConfig, roomConfig } from '../config.ts';
import { joinRoom, rejoinRoom, validateRoomCreationInput } from '../game.ts';
import type { RoomRuntime } from '../rooms/runtime.ts';
import {
  enqueueRoomCreation,
  removeRoomCreationRequest,
  roomCreationQueue,
  saveSharedRoom,
  sharedRoomCounts,
  withLockedRoom,
  withSharedLock
} from '../shared-store.ts';
import { allowSocketAction, isRecord, requestIp } from './shared.ts';
import type { Ack } from './shared.ts';

export function registerRoomHandlers(io: Server, socket: Socket, runtime: RoomRuntime): void {
  socket.on('room:create', async (input: unknown, ack?: Ack<{ code: string; playerId: string; reconnectToken: string }>) => {
    if (!await allowSocketAction(socket, 'create-room', rateLimitConfig.createRoomPerIp, ack)) {
      return;
    }
    try {
      validateRoomCreationInput(input);
      const outcome = await withSharedLock('rooms:create', async () => {
        const ip = requestIp(socket);
        const counts = await sharedRoomCounts(ip);
        const waiting = await roomCreationQueue();
        if (counts.total >= roomConfig.maxConcurrentRooms || waiting.length > 0) {
          return { waiting: true as const };
        }
        if (counts.forIp >= roomConfig.maxRoomsPerIp) {
          throw new Error('Você atingiu o limite de salas ativas por IP. Tente novamente mais tarde.');
        }
        const created = await runtime.createUniqueRoom(input, ip);
        runtime.refreshRoomExpiry(created.room);
        await saveSharedRoom(created.room);
        return { waiting: false as const, created };
      });
      if (outcome.waiting) {
        ack?.({
          ok: false,
          errorCode: 'ROOMS_FULL',
          message: 'O limite de salas simultâneas foi atingido. Você pode entrar na fila para criar sua sala assim que houver uma vaga.'
        });
        return;
      }
      const { room, player } = outcome.created;
      player.socketId = socket.id;
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      void socket.join(room.code);
      void socket.join(player.id);
      await withLockedRoom(room.code, (current) => {
        if (!current) {
          throw new Error('A sala deixou de estar disponível.');
        }
        const currentPlayer = current.players.get(player.id);
        if (!currentPlayer) {
          throw new Error('Não foi possível associar o jogador à sala.');
        }
        currentPlayer.socketId = socket.id;
        runtime.syncRoomTimers(current);
        runtime.emitRoomRoster(current);
        runtime.emitRoomState(current);
        runtime.refreshRoomExpiry(current);
      });
      ack?.({ ok: true, code: room.code, playerId: player.id, reconnectToken: player.reconnectToken });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível criar a sala.' });
    }
  });

  socket.on('room:queue:join', async (
    input: unknown,
    ack?: Ack<{ queued: true; position: number; total: number }>
  ) => {
    if (!await allowSocketAction(socket, 'queue-room', rateLimitConfig.queueRoomPerIp, ack)) {
      return;
    }
    try {
      validateRoomCreationInput(input);
      const requestId = randomUUID();
      const result = await withSharedLock('rooms:create', async () => enqueueRoomCreation({
        id: requestId,
        socketId: socket.id,
        creatorIp: requestIp(socket),
        input,
        queuedAt: Date.now()
      }, roomConfig.maxRoomCreationQueue));
      if (!result) {
        ack?.({
          ok: false,
          message: 'A fila para criação de salas está cheia no momento. Tente novamente mais tarde.'
        });
        return;
      }
      socket.data.roomQueueId = requestId;
      ack?.({ ok: true, queued: true, ...result });
      await runtime.emitRoomQueuePositions();
      await runtime.processRoomCreationQueue();
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível entrar na fila.' });
    }
  });

  socket.on('room:queue:leave', async (_input: unknown, ack?: Ack) => {
    if (!await allowSocketAction(socket, 'leave-room-queue', rateLimitConfig.leaveQueuePerIp, ack)) {
      return;
    }
    try {
      const requestId = socket.data.roomQueueId as string | undefined;
      if (requestId) {
        await withSharedLock('rooms:create', async () => {
          await removeRoomCreationRequest(requestId);
        });
        delete socket.data.roomQueueId;
        await runtime.emitRoomQueuePositions();
        await runtime.processRoomCreationQueue();
      }
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível sair da fila.' });
    }
  });

  socket.on('room:claim', async (input: unknown, ack?: Ack) => {
    try {
      if (!isRecord(input) || typeof input.code !== 'string') {
        throw new Error('Os dados para confirmar a criação da sala são inválidos.');
      }
      const claimed = await withLockedRoom(input.code, (room) => {
        if (!room) {
          throw new Error('A sala expirou antes da confirmação. Tente criar outra.');
        }
        const player = rejoinRoom(room, input.playerId, input.reconnectToken);
        if (player.id !== room.masterId || player.socketId !== null) {
          throw new Error('Não foi possível confirmar a criação desta sala.');
        }
        player.socketId = socket.id;
        player.connected = true;
        player.disconnectExpiresAt = null;
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        delete socket.data.roomQueueId;
        void socket.join(room.code);
        void socket.join(player.id);
        runtime.emitRoomRoster(room);
        runtime.emitRoomState(room);
        runtime.refreshRoomExpiry(room);
        runtime.syncRoomTimers(room);
        return true;
      });
      if (!claimed) {
        throw new Error('A sala expirou antes da confirmação. Tente criar outra.');
      }
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível confirmar a criação da sala.' });
    }
  });

  socket.on('room:join', async (input: unknown, ack?: Ack<{ playerId: string; reconnectToken: string }>) => {
    if (!await allowSocketAction(socket, 'join-room', rateLimitConfig.joinRoomPerIp, ack)) {
      return;
    }
    try {
      if (!isRecord(input) || typeof input.code !== 'string' || typeof input.nickname !== 'string') {
        throw new Error('Os dados informados para entrar na sala são inválidos.');
      }
      const roomCode = input.code;
      const nickname = input.nickname;
      const joined = await withLockedRoom(roomCode, (room) => {
        if (!room) {
          throw new Error('Sala não encontrada. Confira o link ou volte para a página inicial.');
        }
        const player = joinRoom(room, nickname, input.avatar);
        player.socketId = socket.id;
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        void socket.join(room.code);
        void socket.join(player.id);
        runtime.emitRoomRoster(room);
        runtime.emitRoomState(room);
        io.to(room.code).emit('room:notice', `${player.nickname} entrou na partida.`);
        runtime.refreshRoomExpiry(room);
        return player;
      });
      if (!joined) {
        throw new Error('Sala não encontrada. Confira o link ou volte para a página inicial.');
      }
      ack?.({ ok: true, playerId: joined.id, reconnectToken: joined.reconnectToken });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível entrar na sala.' });
    }
  });

  socket.on('room:rejoin', async (input: unknown, ack?: Ack<{ playerId: string; reconnectToken: string }>) => {
    if (!await allowSocketAction(socket, 'rejoin-room', rateLimitConfig.rejoinRoomPerIp, ack)) {
      return;
    }
    try {
      if (!isRecord(input) || typeof input.code !== 'string') {
        throw new Error('Os dados de reconexão são inválidos.');
      }
      const rejoined = await withLockedRoom(input.code, (room) => {
        if (!room) {
          throw new Error('A sala foi encerrada ou expirou. Volte para a página inicial.');
        }
        const player = rejoinRoom(room, input.playerId, input.reconnectToken);
        player.disconnectExpiresAt = null;
        if (player.socketId && player.socketId !== socket.id) {
          io.to(player.id).emit('session:replaced');
          io.sockets.sockets.get(player.socketId)?.disconnect(true);
        }
        player.socketId = socket.id;
        player.connected = true;
        socket.data.roomCode = room.code;
        socket.data.playerId = player.id;
        void socket.join(room.code);
        void socket.join(player.id);
        runtime.emitRoomRoster(room);
        runtime.emitRoomState(room);
        runtime.refreshRoomExpiry(room);
        runtime.syncRoomTimers(room);
        return player;
      });
      if (!rejoined) {
        throw new Error('A sala foi encerrada ou expirou. Volte para a página inicial.');
      }
      ack?.({ ok: true, playerId: rejoined.id, reconnectToken: rejoined.reconnectToken });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível recuperar sua vaga.' });
    }
  });
}
