import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import {
  answerQuestion,
  availableCategories,
  closeRoom,
  createRoom,
  finalRanking,
  forgetRoom,
  joinRoom,
  publicQuestion,
  questionBank,
  restoreRoom,
  revealAnswers,
  roomSnapshot,
  rejoinRoom,
  startGame,
  validateRoomCreationInput
} from './game.ts';
import { rateLimitConfig, roomConfig } from './config.ts';
import {
  consumeSharedRateLimit,
  closeSharedStore,
  enqueueRoomCreation,
  initializeSharedStore,
  listSharedRooms,
  readSharedRoom,
  removeRoomCreationRequest,
  roomCreationQueue,
  restoreSharedRooms,
  saveSharedRoom,
  sharedRoomCounts,
  sharedStoreHealth,
  withLockedRoom,
  withSharedLock
} from './shared-store.ts';
import { randomUUID } from 'node:crypto';
import type { Player, Room } from './types.ts';
import type { Socket } from 'socket.io';

const port = Number(process.env.PORT ?? 3000);
const app = Fastify({ logger: true });
let io: Server;
await app.register(cors, { origin: true });

app.get('/health', async (_request, reply) => {
  const redis = await sharedStoreHealth();
  if (redis === 'error') {
    return reply.code(503).send({ status: 'error', sharedStore: redis });
  }
  return { status: 'ok', sharedStore: redis };
});
app.get('/api/config', async () => ({
  categories: availableCategories(),
  questionCounts: questionBank.reduce<Record<string, number>>((counts, question) => {
    counts[question.categoria] = (counts[question.categoria] ?? 0) + 1;
    return counts;
  }, {}),
  limits: {
    minQuestions: 5,
    maxQuestions: 30,
    minTimeSeconds: 10,
    maxTimeSeconds: 60,
    maxPlayersPerRoom: roomConfig.maxPlayersPerRoom
  }
}));

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

const actionTimers = new Map<string, { deadline: number; timer: NodeJS.Timeout }>();
const expiryTimers = new Map<string, { deadline: number; timer: NodeJS.Timeout }>();
const playerRemovalTimers = new Map<string, { deadline: number; timer: NodeJS.Timeout }>();

function cancelTimer(timers: Map<string, { deadline: number; timer: NodeJS.Timeout }>, key: string): void {
  const entry = timers.get(key);
  if (entry) {
    clearTimeout(entry.timer);
    timers.delete(key);
  }
}

function clearRoomTimers(code: string): void {
  cancelTimer(actionTimers, code);
  cancelTimer(expiryTimers, code);
  for (const key of playerRemovalTimers.keys()) {
    if (key.startsWith(`${code}:`)) {
      cancelTimer(playerRemovalTimers, key);
    }
  }
}

async function emitRoomQueuePositions(): Promise<void> {
  const waiting = await roomCreationQueue();
  waiting.forEach((request, index) => {
    io.to(request.socketId).emit('room:queue:position', {
      position: index + 1,
      total: waiting.length
    });
  });
}

async function createUniqueRoom(input: unknown, creatorIp: string): Promise<{ room: Room; player: Player }> {
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

async function processRoomCreationQueue(): Promise<void> {
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
        const [waitingSocket] = await io.in(next.socketId).fetchSockets();
        if (!waitingSocket) {
          await removeRoomCreationRequest(next.id);
          await emitRoomQueuePositions();
          continue;
        }

        const ipCounts = await sharedRoomCounts(next.creatorIp);
        if (ipCounts.forIp >= roomConfig.maxRoomsPerIp) {
          await removeRoomCreationRequest(next.id);
          io.to(next.socketId).emit('room:queue:error', {
            message: 'Você atingiu o limite de salas ativas por IP. Tente novamente mais tarde.'
          });
          await emitRoomQueuePositions();
          continue;
        }

        try {
          const { room, player } = await createUniqueRoom(next.input, next.creatorIp);
          player.connected = false;
          player.disconnectExpiresAt = Date.now() + roomConfig.playerReconnectGraceMs;
          refreshRoomExpiry(room);
          schedulePlayerRemoval(room, player);
          await saveSharedRoom(room);
          await removeRoomCreationRequest(next.id);
          io.to(next.socketId).emit('room:queue:created', {
            code: room.code,
            playerId: player.id,
            reconnectToken: player.reconnectToken,
            nickname: player.nickname
          });
          await emitRoomQueuePositions();
        } catch (error) {
          await removeRoomCreationRequest(next.id);
          io.to(next.socketId).emit('room:queue:error', {
            message: error instanceof Error ? error.message : 'Não foi possível criar sua sala.'
          });
          await emitRoomQueuePositions();
        }
      }
    });
  } catch (error) {
    app.log.error({ err: error }, 'Failed to process the room creation queue');
  }
}

function scheduleRoomAction(room: Room): void {
  const deadline = room.nextActionAt;
  if (deadline === null) {
    cancelTimer(actionTimers, room.code);
    return;
  }
  const existing = actionTimers.get(room.code);
  if (existing?.deadline === deadline) {
    return;
  }
  cancelTimer(actionTimers, room.code);
  const timer = setTimeout(() => {
    actionTimers.delete(room.code);
    void withLockedRoom(room.code, (current) => {
      if (!current || current.nextActionAt !== deadline || Date.now() < deadline) {
        return;
      }
      current.timer = null;
      if (current.status === 'countdown') {
        sendQuestion(current);
      } else if (current.status === 'question') {
        revealQuestion(current);
      } else if (current.status === 'reveal') {
        advanceAfterReveal(current);
      }
    }).catch((error: unknown) => app.log.error({ err: error }, 'Failed to process scheduled room action'));
  }, Math.max(0, deadline - Date.now()));
  actionTimers.set(room.code, { deadline, timer });
  room.timer = timer;
}

function scheduleRoomExpiry(room: Room): void {
  const deadline = room.expiryAt;
  if (deadline === null) {
    cancelTimer(expiryTimers, room.code);
    return;
  }
  const existing = expiryTimers.get(room.code);
  if (existing?.deadline === deadline) {
    return;
  }
  cancelTimer(expiryTimers, room.code);
  const timer = setTimeout(() => {
    expiryTimers.delete(room.code);
    void withLockedRoom(room.code, (current) => {
      if (!current || current.expiryAt !== deadline || Date.now() < deadline) {
        return;
      }
      const message = current.status === 'finished'
        ? 'O prazo para encerrar a partida expirou.'
        : 'A partida foi encerrada por inatividade. Você será redirecionado para o início.';
      io.to(current.code).emit('room:expired', { code: current.code, message });
      clearRoomTimers(current.code);
      closeRoom(current);
    }).then(processRoomCreationQueue).catch((error: unknown) => app.log.error({ err: error }, 'Failed to expire room'));
  }, Math.max(0, deadline - Date.now()));
  expiryTimers.set(room.code, { deadline, timer });
  room.expiryTimer = timer;
}

function schedulePlayerRemoval(room: Room, player: Player): void {
  const deadline = player.disconnectExpiresAt;
  const key = `${room.code}:${player.id}`;
  if (deadline === null) {
    cancelTimer(playerRemovalTimers, key);
    return;
  }
  const existing = playerRemovalTimers.get(key);
  if (existing?.deadline === deadline) {
    return;
  }
  cancelTimer(playerRemovalTimers, key);
  const timer = setTimeout(() => {
    playerRemovalTimers.delete(key);
    void withLockedRoom(room.code, (current) => {
      const disconnectedPlayer = current?.players.get(player.id);
      if (!current || !disconnectedPlayer || disconnectedPlayer.socketId !== null
          || disconnectedPlayer.disconnectExpiresAt !== deadline || Date.now() < deadline) {
        return;
      }
      current.players.delete(disconnectedPlayer.id);
      io.to(current.code).emit('room:notice', `${disconnectedPlayer.nickname} saiu da partida e não poderá voltar.`);
      emitRoomRoster(current);
      emitRoomState(current);
      if (disconnectedPlayer.id === current.masterId && current.status === 'lobby' && current.players.size === 0) {
        io.to(current.code).emit('room:expired', {
          code: current.code,
          message: 'A sala foi encerrada porque o mestre não concluiu a entrada.'
        });
        clearRoomTimers(current.code);
        closeRoom(current);
      }
    }).then(processRoomCreationQueue).catch((error: unknown) => app.log.error({ err: error }, 'Failed to remove disconnected player'));
  }, Math.max(0, deadline - Date.now()));
  playerRemovalTimers.set(key, { deadline, timer });
  player.disconnectTimer = timer;
}

function refreshRoomExpiry(room: Room, delayMs = roomConfig.inactivityTimeoutMs): void {
  room.expiryAt = Date.now() + delayMs;
  scheduleRoomExpiry(room);
}

function emitRoomState(room: Room): void {
  for (const player of room.players.values()) {
    io.to(player.id).emit('room:state', roomSnapshot(room, player.id));
  }
}

function emitRoomRoster(room: Room): void {
  io.to(room.code).emit('room:roster', {
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

function playerForSocket(room: Room, socket: Socket): Player | undefined {
  const playerId = socket.data.playerId as string | undefined;
  return playerId ? room.players.get(playerId) : undefined;
}

function sendQuestion(room: Room): void {
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
  io.to(room.code).emit('game:question', publicQuestion(room));
  emitRoomState(room);
  scheduleRoomAction(room);
  refreshRoomExpiry(room);
}

function revealQuestion(room: Room): void {
  if (room.status !== 'question') {
    return;
  }
  const question = room.questions[room.questionIndex];
  const results = revealAnswers(room);
  room.status = 'reveal';
  room.timer = null;
  room.nextActionAt = Date.now() + 2500;
  io.to(room.code).emit('game:reveal', {
    questionId: question.id,
    correctIndex: question.correta,
    correctText: question.alternativas[question.correta]
  });
  for (const result of results) {
    io.to(result.playerId).emit('game:answer-result', {
      correct: result.correct,
      selected: result.selected
    });
  }
  emitRoomState(room);
  scheduleRoomAction(room);
  refreshRoomExpiry(room);
}

function advanceAfterReveal(room: Room): void {
  if (room.questionIndex + 1 >= room.questionCount) {
    room.status = 'finished';
    room.nextActionAt = null;
    io.to(room.code).emit('game:ranking', finalRanking(room));
    emitRoomRoster(room);
    emitRoomState(room);
    refreshRoomExpiry(room, roomConfig.rankingRetentionMs);
    return;
  }
  sendQuestion(room);
}

function syncRoomTimers(room: Room): void {
  scheduleRoomAction(room);
  scheduleRoomExpiry(room);
  for (const player of room.players.values()) {
    schedulePlayerRemoval(room, player);
  }
}

function syncAllRoomTimers(): void {
  void listSharedRooms().then((rooms) => {
    for (const room of rooms) {
      syncRoomTimers(room);
    }
  }).catch((error: unknown) => app.log.error({ err: error }, 'Failed to synchronize shared room timers'));
  void roomCreationQueue().then((waiting) => {
    if (waiting.length > 0) {
      return processRoomCreationQueue();
    }
  }).catch((error: unknown) => app.log.error({ err: error }, 'Failed to process the room creation queue'));
}

io = new Server(app.server, {
  cors: { origin: true },
  transports: ['websocket', 'polling']
});
await initializeSharedStore(io);
const restoredRooms = await restoreSharedRooms();
for (const room of restoredRooms) {
  restoreRoom(room);
  syncRoomTimers(room);
}
const timerRecoveryInterval = setInterval(syncAllRoomTimers, 1000);
timerRecoveryInterval.unref();

app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
  const limit = await consumeSharedRateLimit(`room-lookup:${request.ip}`, rateLimitConfig.roomLookupPerIp, rateLimitConfig.windowMs);
  if (!limit.allowed) {
    return reply.header('retry-after', Math.ceil(limit.retryAfterMs / 1000)).code(429)
      .send({ message: 'Muitas consultas de convite. Aguarde um instante e tente novamente.' });
  }
  const result = await withLockedRoom(request.params.code, (room) => {
    if (!room || room.status !== 'lobby') {
      return null;
    }
    return { code: room.code, questionCount: room.questionCount };
  });
  if (!result) {
    return reply.code(404).send({ message: 'Este convite é inválido ou a partida já começou.' });
  }
  return result;
});

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
        const created = await createUniqueRoom(input, ip);
        refreshRoomExpiry(created.room);
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
        syncRoomTimers(current);
        emitRoomRoster(current);
        emitRoomState(current);
        refreshRoomExpiry(current);
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
      await emitRoomQueuePositions();
      await processRoomCreationQueue();
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
        await emitRoomQueuePositions();
        await processRoomCreationQueue();
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
        emitRoomRoster(room);
        emitRoomState(room);
        refreshRoomExpiry(room);
        syncRoomTimers(room);
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
        emitRoomRoster(room);
        emitRoomState(room);
        io.to(room.code).emit('room:notice', `${player.nickname} entrou na partida.`);
        refreshRoomExpiry(room);
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
        emitRoomRoster(room);
        emitRoomState(room);
        refreshRoomExpiry(room);
        syncRoomTimers(room);
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
        emitRoomRoster(room);
        emitRoomState(room);
        io.to(room.code).emit('game:countdown', { seconds: 3, startsAt });
        scheduleRoomAction(room);
        refreshRoomExpiry(room);
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
        refreshRoomExpiry(room);
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
        clearRoomTimers(room.code);
        closeRoom(room);
        return true;
      });
      if (!ended) {
        throw new Error('Sua participação nesta sala não foi encontrada.');
      }
      ack?.({ ok: true });
      await processRoomCreationQueue();
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível encerrar a partida.' });
    }
  });

  socket.on('disconnect', () => {
    const requestId = socket.data.roomQueueId as string | undefined;
    if (requestId) {
      void withSharedLock('rooms:create', async () => removeRoomCreationRequest(requestId))
        .then(async () => {
          await emitRoomQueuePositions();
          await processRoomCreationQueue();
        })
        .catch((error: unknown) => app.log.error({ err: error }, 'Failed to remove disconnected user from room creation queue'));
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
      emitRoomRoster(room);
      io.to(room.code).emit('room:notice', `${player.nickname} perdeu a conexão. A vaga será mantida por 60 segundos.`);
      schedulePlayerRemoval(room, player);
    }).catch((error: unknown) => app.log.error({ err: error }, 'Failed to record player disconnection'));
  });
});

app.addHook('onClose', async () => {
  clearInterval(timerRecoveryInterval);
  for (const timers of [actionTimers, expiryTimers, playerRemovalTimers]) {
    for (const entry of timers.values()) {
      clearTimeout(entry.timer);
    }
    timers.clear();
  }
  await closeSharedStore();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (error) {
  await closeSharedStore();
  throw error;
}
