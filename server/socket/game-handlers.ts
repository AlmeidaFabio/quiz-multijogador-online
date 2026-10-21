import type { Server, Socket } from 'socket.io';
import { rateLimitConfig } from '../config.ts';
import { answerQuestion, closeRoom, startGame } from '../game.ts';
import type { RoomRuntime } from '../rooms/runtime.ts';
import { withLockedRoom } from '../shared-store.ts';
import { allowSocketAction, playerForSocket } from './shared.ts';
import type { Ack } from './shared.ts';

export function registerGameHandlers(io: Server, socket: Socket, runtime: RoomRuntime): void {
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
}
