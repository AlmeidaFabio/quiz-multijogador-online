import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Server, Socket } from 'socket.io';
import { rateLimitConfig, roomConfig } from '../config.ts';
import { answerQuestion, closeRoom, joinRoom, rejoinRoom, startGame, validateRoomCreationInput } from '../game.ts';
import type { RoomRuntime } from '../rooms/runtime.ts';
import {
  consumeSharedRateLimit,
  enqueueRoomCreation,
  removeRoomCreationRequest,
  roomCreationQueue,
  saveSharedRoom,
  sharedRoomCounts,
  withLockedRoom,
  withSharedLock
} from '../shared-store.ts';
import type { Room } from '../types.ts';

type Ack<T = object> = (result:
  | ({ ok: true } & T)
  | { ok: false; message: string; errorCode?: string; position?: number; total?: number }
) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIp(socket: Socket): string {
  return socket.handshake.address || 'unknown';
}

function playerForSocket(room: Room, socket: Socket) {
  const playerId = socket.data.playerId as string | undefined;
  return playerId ? room.players.get(playerId) : undefined;
}

export function registerSocketHandlers(io: Server, runtime: RoomRuntime, logger: FastifyBaseLogger): void {
  async function allowSocketAction(socket: Socket, action: string, limit: number, ack?: Ack): Promise<boolean> {
    const key = `${action}:${socket.handshake.address || 'unknown'}`;
    const result = await consumeSharedRateLimit(key, limit, rateLimitConfig.windowMs);
    if (result.allowed) {
      return true;
    }
    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    ack?.({ ok: false, message: `Muitas tentativas. Aguarde ${seconds} segundo(s) e tente novamente.` });
    return false;
  }

  io.on('connection', (socket) => {
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

    socket.on('room:start', async (_payload: unknown, ack?: Ack) => {
      if (!await allowSocketAction(socket, 'start-game', rateLimitConfig.startGamePerIp, ack)) {
        return;
      }
      try {
        const roomCode = socket.data.roomCode as string | undefined;
        if (!roomCode) {
          throw new Error('Sua participação nesta sala não foi encontrada.');
        }
        const started = await withLockedRoom(roomCode, (room) => {
          const player = room && playerForSocket(room, socket);
          if (!room || !player || player.socketId !== socket.id || player.id !== room.masterId) {
            throw new Error('Apenas o mestre pode iniciar a partida.');
          }
          startGame(room);
          const startsAt = Date.now() + 3000;
          room.countdownEndsAt = startsAt;
          room.nextActionAt = startsAt;
          runtime.emitRoomRoster(room);
          runtime.emitRoomState(room);
          io.to(room.code).emit('game:countdown', { seconds: 3, startsAt });
          runtime.scheduleRoomAction(room);
          runtime.refreshRoomExpiry(room);
          return true;
        });
        if (!started) {
          throw new Error('Sua participação nesta sala não foi encontrada.');
        }
        ack?.({ ok: true });
      } catch (error) {
        ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível iniciar a partida.' });
      }
    });

    socket.on('game:answer', async (selected: number, ack?: Ack) => {
      const playerId = socket.data.playerId as string | undefined;
      if (!await allowSocketAction(socket, `answer:${playerId ?? socket.id}`, rateLimitConfig.answerPerPlayer, ack)) {
        return;
      }
      try {
        const roomCode = socket.data.roomCode as string | undefined;
        if (!roomCode) {
          throw new Error('Sua participação nesta sala não foi encontrada.');
        }
        const accepted = await withLockedRoom(roomCode, (room) => {
          const player = room && playerForSocket(room, socket);
          if (!room || !player || player.socketId !== socket.id) {
            throw new Error('Sua participação nesta sala não foi encontrada.');
          }
          answerQuestion(room, player, selected);
          runtime.refreshRoomExpiry(room);
          return player.id;
        });
        if (!accepted) {
          throw new Error('Sua participação nesta sala não foi encontrada.');
        }
        ack?.({ ok: true });
        socket.emit('game:answer-accepted');
      } catch (error) {
        ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível enviar sua resposta.' });
      }
    });

    socket.on('room:end', async (_payload: unknown, ack?: Ack) => {
      const playerId = socket.data.playerId as string | undefined;
      if (!await allowSocketAction(socket, `end-room:${playerId ?? socket.id}`, rateLimitConfig.endRoomPerIp, ack)) {
        return;
      }
      try {
        const roomCode = socket.data.roomCode as string | undefined;
        if (!roomCode) {
          throw new Error('Sua participação nesta sala não foi encontrada.');
        }
        const ended = await withLockedRoom(roomCode, (room) => {
          const player = room && playerForSocket(room, socket);
          if (!room || !player || player.socketId !== socket.id || player.id !== room.masterId) {
            throw new Error('Apenas o mestre pode encerrar a partida.');
          }
          if (room.status !== 'finished') {
            throw new Error('A partida só pode ser encerrada na tela do ranking final.');
          }
          io.to(room.code).emit('room:ended', { code: room.code });
          runtime.clearRoomTimers(room.code);
          closeRoom(room);
          return true;
        });
        if (!ended) {
          throw new Error('Sua participação nesta sala não foi encontrada.');
        }
        ack?.({ ok: true });
        await runtime.processRoomCreationQueue();
      } catch (error) {
        ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível encerrar a partida.' });
      }
    });

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
