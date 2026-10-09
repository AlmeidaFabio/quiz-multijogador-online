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
  startGame
} from './game.ts';
import type { Player, Room } from './types.ts';

const port = Number(process.env.PORT ?? 3000);
const app = Fastify({ logger: true });
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

  room.timer = setTimeout(() => {
    if (room.questionIndex + 1 >= room.questionCount) {
      room.status = 'finished';
      io.to(room.code).emit('game:ranking', finalRanking(room));
      emitRoomRoster(room);
      emitRoomState(room);
      room.timer = null;
      return;
    }
    sendQuestion(room);
  }, 2500);
}

io.on('connection', (socket) => {
  socket.on('room:create', (input: {
    categories: string[];
    questionCount: number;
    timePerQuestionSeconds: number;
    nickname: string;
  }, ack?: Ack<{ code: string; playerId: string }>) => {
    try {
      const { room, player } = createRoom(input);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      void socket.join(room.code);
      void socket.join(player.id);
      ack?.({ ok: true, code: room.code, playerId: player.id });
      emitRoomRoster(room);
      emitRoomState(room);
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível criar a sala.' });
    }
  });

  socket.on('room:join', (input: { code: string; nickname: string }, ack?: Ack<{ playerId: string }>) => {
    try {
      const room = getRoom(input.code);
      if (!room) {
        throw new Error('Sala não encontrada. Confira o link ou volte para a página inicial.');
      }
      const player = joinRoom(room, input.nickname);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      void socket.join(room.code);
      void socket.join(player.id);
      ack?.({ ok: true, playerId: player.id });
      emitRoomRoster(room);
      emitRoomState(room);
      io.to(room.code).emit('room:notice', `${player.nickname} entrou na partida.`);
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível entrar na sala.' });
    }
  });

  socket.on('room:start', (_payload: unknown, ack?: Ack) => {
    try {
      const context = playerFromSocket(socket);
      if (!context || context.player.id !== context.room.masterId) {
        throw new Error('Apenas o mestre pode iniciar a partida.');
      }
      startGame(context.room);
      emitRoomRoster(context.room);
      emitRoomState(context.room);
      const startsAt = Date.now() + 3000;
      io.to(context.room.code).emit('game:countdown', { seconds: 3, startsAt });
      context.room.timer = setTimeout(() => sendQuestion(context.room), Math.max(0, startsAt - Date.now()));
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível iniciar a partida.' });
    }
  });

  socket.on('game:answer', (selected: number, ack?: Ack) => {
    try {
      const context = playerFromSocket(socket);
      if (!context) {
        throw new Error('Sua participação nesta sala não foi encontrada.');
      }
      answerQuestion(context.room, context.player, selected);
      ack?.({ ok: true });
      socket.emit('game:answer-accepted');
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível enviar sua resposta.' });
    }
  });

  socket.on('room:end', (_payload: unknown, ack?: Ack) => {
    try {
      const context = playerFromSocket(socket);
      if (!context || context.player.id !== context.room.masterId) {
        throw new Error('Apenas o mestre pode encerrar a partida.');
      }
      if (context.room.status !== 'finished') {
        throw new Error('A partida só pode ser encerrada na tela do ranking final.');
      }

      io.to(context.room.code).emit('room:ended');
      closeRoom(context.room);
      ack?.({ ok: true });
    } catch (error) {
      ack?.({ ok: false, message: error instanceof Error ? error.message : 'Não foi possível encerrar a partida.' });
    }
  });

  socket.on('disconnect', () => {
    const context = playerFromSocket(socket);
    if (context) {
      context.player.connected = false;
      emitRoomRoster(context.room);
    }
  });
});

await app.listen({ port, host: '0.0.0.0' });
