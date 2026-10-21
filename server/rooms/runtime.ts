import type { FastifyBaseLogger } from 'fastify';
import type { Server } from 'socket.io';
import { roomConfig } from '../config.ts';
import { closeRoom, createRoom, finalRanking, forgetRoom, publicQuestion, restoreRoom, revealAnswers, roomSnapshot } from '../game.ts';
import {
  listSharedRooms,
  readSharedRoom,
  removeRoomCreationRequest,
  roomCreationQueue,
  saveSharedRoom,
  sharedRoomCounts,
  withLockedRoom,
  withSharedLock
} from '../shared-store.ts';
import type { Player, Room } from '../types.ts';

type TimerEntry = { deadline: number; timer: NodeJS.Timeout };

export class RoomRuntime {
  private readonly actionTimers = new Map<string, TimerEntry>();
  private readonly expiryTimers = new Map<string, TimerEntry>();
  private readonly playerRemovalTimers = new Map<string, TimerEntry>();

  constructor(private readonly io: Server, private readonly logger: FastifyBaseLogger) {}

  clearRoomTimers(code: string): void {
    this.cancelTimer(this.actionTimers, code);
    this.cancelTimer(this.expiryTimers, code);
    for (const key of this.playerRemovalTimers.keys()) {
      if (key.startsWith(`${code}:`)) {
        this.cancelTimer(this.playerRemovalTimers, key);
      }
    }
  }

  async emitRoomQueuePositions(): Promise<void> {
    const waiting = await roomCreationQueue();
    waiting.forEach((request, index) => {
      this.io.to(request.socketId).emit('room:queue:position', {
        position: index + 1,
        total: waiting.length
      });
    });
  }

  async createUniqueRoom(input: unknown, creatorIp: string): Promise<{ room: Room; player: Player }> {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const created = createRoom(input, creatorIp, false);
      const existingCode = created.room.code;
      forgetRoom(existingCode);
      const collision = await readSharedRoom(existingCode);
      if (!collision) {
        restoreRoom(created.room);
        return created;
      }
      closeRoom(created.room);
    }
    throw new Error('Não foi possível gerar um código de sala exclusivo. Tente novamente.');
  }

  async processRoomCreationQueue(): Promise<void> {
    try {
      await withSharedLock('rooms:create', async () => {
        while (true) {
          const waiting = await roomCreationQueue();
          if (waiting.length === 0) {
            return;
          }
          const counts = await sharedRoomCounts('unknown');
          if (counts.total >= roomConfig.maxConcurrentRooms) {
            return;
          }
          const next = waiting[0];
          if (!next) {
            return;
          }
          const [waitingSocket] = await this.io.in(next.socketId).fetchSockets();
          if (!waitingSocket) {
            await removeRoomCreationRequest(next.id);
            await this.emitRoomQueuePositions();
            continue;
          }

          const ipCounts = await sharedRoomCounts(next.creatorIp);
          if (ipCounts.forIp >= roomConfig.maxRoomsPerIp) {
            await removeRoomCreationRequest(next.id);
            this.io.to(next.socketId).emit('room:queue:error', {
              message: 'Você atingiu o limite de salas ativas por IP. Tente novamente mais tarde.'
            });
            await this.emitRoomQueuePositions();
            continue;
          }

          try {
            const { room, player } = await this.createUniqueRoom(next.input, next.creatorIp);
            player.connected = false;
            player.disconnectExpiresAt = Date.now() + roomConfig.playerReconnectGraceMs;
            this.refreshRoomExpiry(room);
            this.schedulePlayerRemoval(room, player);
            await saveSharedRoom(room);
            await removeRoomCreationRequest(next.id);
            this.io.to(next.socketId).emit('room:queue:created', {
              code: room.code,
              playerId: player.id,
              reconnectToken: player.reconnectToken,
              nickname: player.nickname
            });
            await this.emitRoomQueuePositions();
          } catch (error) {
            await removeRoomCreationRequest(next.id);
            this.io.to(next.socketId).emit('room:queue:error', {
              message: error instanceof Error ? error.message : 'Não foi possível criar sua sala.'
            });
            await this.emitRoomQueuePositions();
          }
        }
      });
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to process the room creation queue');
    }
  }

  scheduleRoomAction(room: Room): void {
    const deadline = room.nextActionAt;
    if (deadline === null) {
      this.cancelTimer(this.actionTimers, room.code);
      return;
    }
    const existing = this.actionTimers.get(room.code);
    if (existing?.deadline === deadline) {
      return;
    }
    this.cancelTimer(this.actionTimers, room.code);
    const timer = setTimeout(() => {
      this.actionTimers.delete(room.code);
      void withLockedRoom(room.code, (current) => {
        if (!current || current.nextActionAt !== deadline || Date.now() < deadline) {
          return;
        }
        current.timer = null;
        if (current.status === 'countdown') {
          this.sendQuestion(current);
        } else if (current.status === 'question') {
          this.revealQuestion(current);
        } else if (current.status === 'reveal') {
          this.advanceAfterReveal(current);
        }
      }).catch((error: unknown) => this.logger.error({ err: error }, 'Failed to process scheduled room action'));
    }, Math.max(0, deadline - Date.now()));
    this.actionTimers.set(room.code, { deadline, timer });
    room.timer = timer;
  }

  scheduleRoomExpiry(room: Room): void {
    const deadline = room.expiryAt;
    if (deadline === null) {
      this.cancelTimer(this.expiryTimers, room.code);
      return;
    }
    const existing = this.expiryTimers.get(room.code);
    if (existing?.deadline === deadline) {
      return;
    }
    this.cancelTimer(this.expiryTimers, room.code);
    const timer = setTimeout(() => {
      this.expiryTimers.delete(room.code);
      void withLockedRoom(room.code, (current) => {
        if (!current || current.expiryAt !== deadline || Date.now() < deadline) {
          return;
        }
        const message = current.status === 'finished'
          ? 'O prazo para encerrar a partida expirou.'
          : 'A partida foi encerrada por inatividade. Você será redirecionado para o início.';
        this.io.to(current.code).emit('room:expired', { code: current.code, message });
        this.clearRoomTimers(current.code);
        closeRoom(current);
      }).then(() => this.processRoomCreationQueue())
        .catch((error: unknown) => this.logger.error({ err: error }, 'Failed to expire room'));
    }, Math.max(0, deadline - Date.now()));
    this.expiryTimers.set(room.code, { deadline, timer });
    room.expiryTimer = timer;
  }

  schedulePlayerRemoval(room: Room, player: Player): void {
    const deadline = player.disconnectExpiresAt;
    const key = `${room.code}:${player.id}`;
    if (deadline === null) {
      this.cancelTimer(this.playerRemovalTimers, key);
      return;
    }
    const existing = this.playerRemovalTimers.get(key);
    if (existing?.deadline === deadline) {
      return;
    }
    this.cancelTimer(this.playerRemovalTimers, key);
    const timer = setTimeout(() => {
      this.playerRemovalTimers.delete(key);
      void withLockedRoom(room.code, (current) => {
        const disconnectedPlayer = current?.players.get(player.id);
        if (!current || !disconnectedPlayer || disconnectedPlayer.socketId !== null
            || disconnectedPlayer.disconnectExpiresAt !== deadline || Date.now() < deadline) {
          return;
        }
        current.players.delete(disconnectedPlayer.id);
        this.io.to(current.code).emit('room:notice', `${disconnectedPlayer.nickname} saiu da partida e não poderá voltar.`);
        this.emitRoomRoster(current);
        this.emitRoomState(current);
        if (disconnectedPlayer.id === current.masterId && current.status === 'lobby' && current.players.size === 0) {
          this.io.to(current.code).emit('room:expired', {
            code: current.code,
            message: 'A sala foi encerrada porque o mestre não concluiu a entrada.'
          });
          this.clearRoomTimers(current.code);
          closeRoom(current);
        }
      }).then(() => this.processRoomCreationQueue())
        .catch((error: unknown) => this.logger.error({ err: error }, 'Failed to remove disconnected player'));
    }, Math.max(0, deadline - Date.now()));
    this.playerRemovalTimers.set(key, { deadline, timer });
    player.disconnectTimer = timer;
  }

  refreshRoomExpiry(room: Room, delayMs = roomConfig.inactivityTimeoutMs): void {
    room.expiryAt = Date.now() + delayMs;
    this.scheduleRoomExpiry(room);
  }

  emitRoomState(room: Room): void {
    for (const player of room.players.values()) {
      this.io.to(player.id).emit('room:state', roomSnapshot(room, player.id));
    }
  }

  emitRoomRoster(room: Room): void {
    this.io.to(room.code).emit('room:roster', {
      players: [...room.players.values()].map((player) => ({
        id: player.id,
        nickname: player.nickname,
        avatar: player.avatar,
        points: player.points,
        isMaster: player.id === room.masterId
      })),
      status: room.status,
      playerCount: room.players.size
    });
  }

  sendQuestion(room: Room): void {
    room.status = 'question';
    room.countdownEndsAt = null;
    room.questionIndex += 1;
    room.questionOpenedAt = Date.now();
    room.questionEndsAt = room.questionOpenedAt + room.timePerQuestionSeconds * 1000;
    room.nextActionAt = room.questionEndsAt;
    for (const player of room.players.values()) {
      player.answer = null;
      player.answerReceivedAt = null;
    }
    this.io.to(room.code).emit('game:question', publicQuestion(room));
    this.emitRoomState(room);
    this.scheduleRoomAction(room);
    this.refreshRoomExpiry(room);
  }

  revealQuestion(room: Room): void {
    if (room.status !== 'question') {
      return;
    }
    const question = room.questions[room.questionIndex];
    const results = revealAnswers(room);
    room.status = 'reveal';
    room.timer = null;
    room.nextActionAt = Date.now() + 2500;
    this.io.to(room.code).emit('game:reveal', {
      questionId: question.id,
      correctIndex: question.correta,
      correctText: question.alternativas[question.correta]
    });
    for (const result of results) {
      this.io.to(result.playerId).emit('game:answer-result', {
        correct: result.correct,
        selected: result.selected
      });
    }
    this.emitRoomState(room);
    this.scheduleRoomAction(room);
    this.refreshRoomExpiry(room);
  }

  advanceAfterReveal(room: Room): void {
    if (room.questionIndex + 1 >= room.questionCount) {
      room.status = 'finished';
      room.nextActionAt = null;
      this.io.to(room.code).emit('game:ranking', finalRanking(room));
      this.emitRoomRoster(room);
      this.emitRoomState(room);
      this.refreshRoomExpiry(room, roomConfig.rankingRetentionMs);
      return;
    }
    this.sendQuestion(room);
  }

  syncRoomTimers(room: Room): void {
    this.scheduleRoomAction(room);
    this.scheduleRoomExpiry(room);
    for (const player of room.players.values()) {
      this.schedulePlayerRemoval(room, player);
    }
  }

  syncAllRoomTimers(): void {
    void listSharedRooms().then((rooms) => {
      for (const room of rooms) {
        this.syncRoomTimers(room);
      }
    }).catch((error: unknown) => this.logger.error({ err: error }, 'Failed to synchronize shared room timers'));
    void roomCreationQueue().then((waiting) => {
      if (waiting.length > 0) {
        return this.processRoomCreationQueue();
      }
    }).catch((error: unknown) => this.logger.error({ err: error }, 'Failed to process the room creation queue'));
  }

  dispose(): void {
    for (const timers of [this.actionTimers, this.expiryTimers, this.playerRemovalTimers]) {
      for (const entry of timers.values()) {
        clearTimeout(entry.timer);
      }
      timers.clear();
    }
  }

  private cancelTimer(timers: Map<string, TimerEntry>, key: string): void {
    const entry = timers.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      timers.delete(key);
    }
  }
}
