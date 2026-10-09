import { randomInt, randomUUID } from 'node:crypto';
import { questionBank } from './questions.ts';
import type { Player, PlayerSummary, PublicQuestion, Room, RoomSnapshot } from './types.ts';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map<string, Room>();
export { questionBank } from './questions.ts';

export function availableCategories(): string[] {
  return [...new Set(questionBank.map((question) => question.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function getRoom(code: string): Room | undefined {
  return rooms.get(code.toUpperCase());
}

export function createRoom(input: {
  categories: string[];
  questionCount: number;
  timePerQuestionSeconds: number;
  nickname: string;
}): { room: Room; player: Player } {
  const pool = questionBank.filter((question) => input.categories.includes(question.categoria));
  if (input.categories.length < 1 || input.categories.some((category) => !availableCategories().includes(category))) {
    throw new Error('Selecione pelo menos uma categoria válida.');
  }
  if (!Number.isInteger(input.questionCount) || input.questionCount < 5 || input.questionCount > 30) {
    throw new Error('A quantidade de perguntas deve estar entre 5 e 30.');
  }
  if (!Number.isInteger(input.timePerQuestionSeconds) || input.timePerQuestionSeconds < 10 || input.timePerQuestionSeconds > 60) {
    throw new Error('O tempo por pergunta deve estar entre 10 e 60 segundos.');
  }
  if (pool.length < input.questionCount) {
    throw new Error(`As categorias selecionadas têm apenas ${pool.length} perguntas disponíveis.`);
  }
  validateNickname(input.nickname);

  let code: string;
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));

  const player: Player = {
    id: randomUUID(),
    nickname: input.nickname.trim(),
    points: 0,
    totalAnswerTimeMs: 0,
    answeredQuestions: new Set(),
    answer: null,
    answerReceivedAt: null,
    connected: true
  };
  const room: Room = {
    code,
    categories: input.categories,
    questionCount: input.questionCount,
    timePerQuestionSeconds: input.timePerQuestionSeconds,
    status: 'lobby',
    players: new Map([[player.id, player]]),
    masterId: player.id,
    questions: [],
    questionIndex: -1,
    questionOpenedAt: null,
    questionEndsAt: null,
    timer: null
  };
  rooms.set(code, room);
  return { room, player };
}

export function validateNickname(nickname: unknown): asserts nickname is string {
  if (typeof nickname !== 'string') {
    throw new Error('Informe um nickname válido.');
  }
  const trimmed = nickname.trim();
  if (trimmed !== nickname || trimmed.length < 2 || trimmed.length > 20 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error('O nickname deve ter de 2 a 20 caracteres, sem espaços nas pontas.');
  }
}

export function joinRoom(room: Room, nickname: string): Player {
  if (room.status !== 'lobby') {
    throw new Error('Esta partida já começou e não aceita novas entradas.');
  }
  validateNickname(nickname);
  if ([...room.players.values()].some((player) => player.nickname.toLocaleLowerCase('pt-BR') === nickname.toLocaleLowerCase('pt-BR'))) {
    throw new Error('Esse nickname já está em uso nesta sala.');
  }
  const player: Player = {
    id: randomUUID(),
    nickname,
    points: 0,
    totalAnswerTimeMs: 0,
    answeredQuestions: new Set(),
    answer: null,
    answerReceivedAt: null,
    connected: true
  };
  room.players.set(player.id, player);
  return player;
}

export function shuffle<T>(values: T[]): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function publicQuestion(room: Room): PublicQuestion | null {
  const question = room.questions[room.questionIndex];
  if (!question || room.questionEndsAt === null) {
    return null;
  }
  const { correta: _answerKey, ...publicData } = question;
  return {
    ...publicData,
    number: room.questionIndex + 1,
    total: room.questionCount,
    endsAt: room.questionEndsAt
  };
}

export function roomSnapshot(room: Room, viewerId: string): RoomSnapshot {
  return {
    code: room.code,
    status: room.status,
    players: sortedPlayers(room).map((player) => ({
      id: player.id,
      nickname: player.nickname,
      points: player.points,
      isMaster: player.id === room.masterId
    })),
    playerCount: room.players.size,
    isMaster: viewerId === room.masterId,
    questionCount: room.questionCount,
    questionIndex: room.questionIndex,
    timePerQuestionSeconds: room.timePerQuestionSeconds,
    question: room.status === 'question' ? publicQuestion(room) : null
  };
}

export function sortedPlayers(room: Room): Player[] {
  return [...room.players.values()].sort((a, b) =>
    b.points - a.points || a.totalAnswerTimeMs - b.totalAnswerTimeMs || a.nickname.localeCompare(b.nickname, 'pt-BR')
  );
}

export function answerQuestion(room: Room, player: Player, selected: unknown): void {
  if (room.status !== 'question' || room.questionOpenedAt === null || room.questionEndsAt === null) {
    throw new Error('Não há uma pergunta aberta para responder.');
  }
  if (Date.now() >= room.questionEndsAt) {
    throw new Error('O tempo para responder acabou.');
  }
  const question = room.questions[room.questionIndex];
  if (player.answer !== null) {
    throw new Error('Você já respondeu esta pergunta.');
  }
  if (typeof selected !== 'number' || !Number.isInteger(selected) || selected < 0 || selected >= question.alternativas.length) {
    throw new Error('A alternativa selecionada é inválida.');
  }
  player.answer = selected;
  player.answerReceivedAt = Date.now();
  player.answeredQuestions.add(question.id);
}

export function startGame(room: Room): void {
  if (room.status !== 'lobby') {
    throw new Error('A partida já foi iniciada.');
  }
  const candidates = shuffle(questionBank.filter((question) => room.categories.includes(question.categoria)));
  if (candidates.length < room.questionCount) {
    throw new Error('Não há perguntas suficientes nas categorias selecionadas.');
  }
  room.questions = candidates.slice(0, room.questionCount);
  room.questionIndex = -1;
  room.status = 'countdown';
}

export function closeRoom(room: Room): void {
  if (room.timer) {
    clearTimeout(room.timer);
  }
  rooms.delete(room.code);
}

export function finalRanking(room: Room): Array<PlayerSummary & { position: number; totalAnswerTimeMs: number }> {
  let previousPoints: number | null = null;
  let previousTime: number | null = null;
  let position = 0;
  return sortedPlayers(room).map((player, index) => {
    if (player.points !== previousPoints || player.totalAnswerTimeMs !== previousTime) {
      position = index + 1;
    }
    previousPoints = player.points;
    previousTime = player.totalAnswerTimeMs;
    return {
      id: player.id,
      nickname: player.nickname,
      points: player.points,
      isMaster: player.id === room.masterId,
      position,
      totalAnswerTimeMs: player.totalAnswerTimeMs
    };
  });
}

export function revealAnswers(room: Room): Array<{ playerId: string; correct: boolean; selected: number | null }> {
  const question = room.questions[room.questionIndex];
  const now = Date.now();
  return [...room.players.values()].map((player) => {
    const elapsedMs = player.answerReceivedAt === null
      ? room.timePerQuestionSeconds * 1000
      : Math.min(room.timePerQuestionSeconds * 1000, player.answerReceivedAt - (room.questionOpenedAt ?? now));
    const correct = player.answer === question.correta;
    if (correct) {
      const elapsedSeconds = elapsedMs / 1000;
      player.points += Math.round(500 + 500 * ((room.timePerQuestionSeconds - elapsedSeconds) / room.timePerQuestionSeconds));
      player.totalAnswerTimeMs += elapsedMs;
    } else {
      player.totalAnswerTimeMs += room.timePerQuestionSeconds * 1000;
    }
    return { playerId: player.id, correct, selected: player.answer };
  });
}
