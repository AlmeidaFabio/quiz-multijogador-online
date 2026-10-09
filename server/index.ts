import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Server } from 'socket.io';
import {
  answerQuestion,
  availableCategories,
  closeRoom,
  createRoom,
  finalRanking,
  getRoom,
  joinRoom,
  publicQuestion,
  questionBank,
  revealAnswers,
  roomSnapshot,
  rejoinRoom,
  schedulePlayerRemoval,
  scheduleRoomExpiry,
  startGame
} from './game.ts';
import { rateLimitConfig, roomConfig } from './config.ts';
import { FixedWindowRateLimiter } from './rate-limit.ts';
import type { Player, Room } from './types.ts';
import type { Socket } from 'socket.io';

const port = Number(process.env.PORT ?? 3000);
const app = Fastify({ logger: true });
const rateLimiter = new FixedWindowRateLimiter();
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok' }));
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
    maxTimeSeconds: 60
  }
}));
app.get<{ Params: { code: string } }>('/api/rooms/:code', async (request, reply) => {
  const limit = rateLimiter.consume(`room-lookup:${request.ip}`, rateLimitConfig.roomLookupPerIp, rateLimitConfig.windowMs);
  if (!limit.allowed) {
    return reply.header('retry-after', Math.ceil(limit.retryAfterMs / 1000)).code(429)
      .send({ message: 'Muitas consultas de convite. Aguarde um instante e tente novamente.' });
  }
  const room = getRoom(request.params.code);
  if (!room || room.status !== 'lobby') {
    return reply.code(404).send({ message: 'Este convite é inválido ou a partida já começou.' });
  }
  return { code: room.code, questionCount: room.questionCount };
});

const io = new Server(app.server, {
  cors: { origin: true },
  transports: ['websocket', 'polling']
});

type Ack<T = object> = (result: { ok: true } & T | { ok: false; message: string }) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requestIp(socket: Socket): string {
  return socket.handshake.address || 'unknown';
}

function allowSocketAction(socket: Socket, action: string, limit: number, ack?: Ack): boolean {
  const key = `${action}:${socket.handshake.address || 'unknown'}`;
  const result = rateLimiter.consume(key, limit, rateLimitConfig.windowMs);
  if (result.allowed) {
    return true;
  }
  const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
  ack?.({ ok: false, message: `Muitas tentativas. Aguarde ${seconds} segundo(s) e tente novamente.` });
  return false;
}

function refreshRoomExpiry(room: Room, delayMs = roomConfig.inactivityTimeoutMs): void {
  scheduleRoomExpiry(room, delayMs, () => {
    io.to(room.code).emit('room:expired', {
      code: room.code,
      message: 'A partida foi encerrada por inatividade. Você será redirecionado para o início.'
    });
  });
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
      points: player.points,
      isMaster: player.id === room.masterId
    })),
    status: room.status,
    playerCount: room.players.size
  });
}

function playerFromSocket(socket: typeof io extends Server ? import('socket.io').Socket : never): {
  room: Room;
  player: Player;
} | null {
  const roomCode = socket.data.roomCode as string | undefined;
  const playerId = socket.data.playerId as string | undefined;
  if (!roomCode || !playerId) {
    return null;
  }
  const room = getRoom(roomCode);
  const player = room?.players.get(playerId);
  return room && player ? { room, player } : null;
}

function sendQuestion(room: Room): void {
  room.status = 'question';
  room.countdownEndsAt = null;
  room.questionIndex += 1;
  room.questionOpenedAt = Date.now();
  room.questionEndsAt = room.questionOpenedAt + room.timePerQuestionSeconds * 1000;
  for (const player of room.players.values()) {
    player.answer = null;
    player.answerReceivedAt = null;
  }
  io.to(room.code).emit('game:question', publicQuestion(room));
  emitRoomState(room);
  room.timer = setTimeout(() => revealQuestion(room), room.timePerQuestionSeconds * 1000);
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
  refreshRoomExpiry(room);

  room.timer = setTimeout(() => {
    if (room.questionIndex + 1 >= room.questionCount) {
      room.status = 'finished';
      io.to(room.code).emit('game:ranking', finalRanking(room));
      emitRoomRoster(room);
      emitRoomState(room);
      room.timer = null;
      refreshRoomExpiry(room, roomConfig.rankingRetentionMs);
      return;
    }
    sendQuestion(room);
  }, 2500);
}

io.on('connection', (socket) => {
  socket.on('room:create', (input: unknown, ack?: Ack<{ code: string; playerId: string; reconnectToken: string }>) => {
    if (!allowSocketAction(socket, 'create-room', rateLimitConfig.createRoomPerIp, ack)) {
      return;
    }
    try {
      const { room, player } = createRoom(input, requestIp(socket));
      player.socketId = socket.id;
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      void socket.join(room.code);
      void socket.join(player.id);
      ack?.({ ok: true, code: room.code, playerId: player.id, reconnectToken: player.reconnectToken });
      emitRoomRoster(room);
      emitRoomState(room);
      refreshRoomExpiry(room);
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível criar a sala.' });
    }
  });

  socket.on('room:join', (input: unknown, ack?: Ack<{ playerId: string; reconnectToken: string }>) => {
    if (!allowSocketAction(socket, 'join-room', rateLimitConfig.joinRoomPerIp, ack)) {
      return;
    }
    try {
      if (!isRecord(input) || typeof input.code !== 'string') {
        throw new Error('O convite informado é inválido.');
      }
      const room = getRoom(input.code);
      if (!room) {
        throw new Error('Sala não encontrada. Confira o link ou volte para a página inicial.');
      }
      if (typeof input.nickname !== 'string') {
        throw new Error('Informe um nickname válido.');
      }
      const player = joinRoom(room, input.nickname);
      player.socketId = socket.id;
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      void socket.join(room.code);
      void socket.join(player.id);
      ack?.({ ok: true, playerId: player.id, reconnectToken: player.reconnectToken });
      emitRoomRoster(room);
      emitRoomState(room);
      io.to(room.code).emit('room:notice', `${player.nickname} entrou na partida.`);
      refreshRoomExpiry(room);
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível entrar na sala.' });
    }
  });

  socket.on('room:rejoin', (input: unknown, ack?: Ack<{ playerId: string; reconnectToken: string }>) => {
    if (!allowSocketAction(socket, 'rejoin-room', rateLimitConfig.rejoinRoomPerIp, ack)) {
      return;
    }
    try {
      if (!isRecord(input)) {
        throw new Error('Os dados de reconexão são inválidos.');
      }
      const room = getRoom(input.code);
      if (!room) {
        throw new Error('A sala foi encerrada ou expirou. Volte para a página inicial.');
      }
      const player = rejoinRoom(room, input.playerId, input.reconnectToken);
      if (player.socketId && player.socketId !== socket.id) {
        io.sockets.sockets.get(player.socketId)?.disconnect(true);
      }
      player.socketId = socket.id;
      player.connected = true;
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      void socket.join(room.code);
      void socket.join(player.id);
      ack?.({ ok: true, playerId: player.id, reconnectToken: player.reconnectToken });
      emitRoomRoster(room);
      emitRoomState(room);
      refreshRoomExpiry(room);
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível recuperar sua vaga.' });
    }
  });

  socket.on('room:start', (_payload: unknown, ack?: Ack) => {
    if (!allowSocketAction(socket, 'start-game', rateLimitConfig.startGamePerIp, ack)) {
      return;
    }
    try {
      const context = playerFromSocket(socket);
      if (!context || context.player.id !== context.room.masterId) {
        throw new Error('Apenas o mestre pode iniciar a partida.');
      }
      startGame(context.room);
      const startsAt = Date.now() + 3000;
      context.room.countdownEndsAt = startsAt;
      emitRoomRoster(context.room);
      emitRoomState(context.room);
      io.to(context.room.code).emit('game:countdown', { seconds: 3, startsAt });
      context.room.timer = setTimeout(() => sendQuestion(context.room), Math.max(0, startsAt - Date.now()));
      refreshRoomExpiry(context.room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível iniciar a partida.' });
    }
  });

  socket.on('game:answer', (selected: number, ack?: Ack) => {
    const context = playerFromSocket(socket);
    if (!allowSocketAction(socket, `answer:${context?.player.id ?? socket.id}`, rateLimitConfig.answerPerPlayer, ack)) {
      return;
    }
    try {
      if (!context) {
        throw new Error('Sua participação nesta sala não foi encontrada.');
      }
      answerQuestion(context.room, context.player, selected);
      refreshRoomExpiry(context.room);
      ack?.({ ok: true });
      socket.emit('game:answer-accepted');
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível enviar sua resposta.' });
    }
  });

  socket.on('room:end', (_payload: unknown, ack?: Ack) => {
    const context = playerFromSocket(socket);
    if (!allowSocketAction(socket, `end-room:${context?.player.id ?? socket.id}`, rateLimitConfig.endRoomPerIp, ack)) {
      return;
    }
    try {
      if (!context || context.player.id !== context.room.masterId) {
        throw new Error('Apenas o mestre pode encerrar a partida.');
      }
      if (context.room.status !== 'finished') {
        throw new Error('A partida só pode ser encerrada na tela do ranking final.');
      }

      io.to(context.room.code).emit('room:ended', { code: context.room.code });
      closeRoom(context.room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível encerrar a partida.' });
    }
  });

  socket.on('disconnect', () => {
    const context = playerFromSocket(socket);
    if (context && context.player.socketId === socket.id) {
      context.player.connected = false;
      context.player.socketId = null;
      emitRoomRoster(context.room);
      io.to(context.room.code).emit('room:notice', `${context.player.nickname} perdeu a conexão. A vaga será mantida por 60 segundos.`);
      schedulePlayerRemoval(context.room, context.player, roomConfig.playerReconnectGraceMs, () => {
        io.to(context.room.code).emit('room:notice', `${context.player.nickname} saiu da partida e não poderá voltar.`);
        emitRoomRoster(context.room);
        emitRoomState(context.room);
      });
    }
  });
});

await app.listen({ port, host: '0.0.0.0' });
