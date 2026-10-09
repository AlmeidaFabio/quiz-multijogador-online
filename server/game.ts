import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { roomConfig } from './config.ts';
import { questionBank } from './questions.ts';
import type { Player, PlayerSummary, PublicQuestion, Room, RoomSnapshot } from './types.ts';

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map<string, Room>();
export { questionBank } from './questions.ts';

export function restoreRoom(room: Room): void {
  rooms.set(room.code, room);
}

export function serializeRoom(room: Room): string {
  return JSON.stringify({
    ...room,
    players: [...room.players.values()].map((player) => ({
      ...player,
      answeredQuestions: [...player.answeredQuestions],
      disconnectTimer: null
    })),
    timer: null,
    expiryTimer: null
  });
}

export function deserializeRoom(serialized: string): Room {
  const value = JSON.parse(serialized) as Omit<Room, 'players' | 'timer' | 'expiryTimer'> & {
    players: Array<Omit<Player, 'answeredQuestions' | 'disconnectTimer'> & {
      answeredQuestions: string[];
      disconnectTimer: null;
    }>;
    timer: null;
    expiryTimer: null;
  };
  return {
    ...value,
    players: new Map(value.players.map((player) => [
      player.id,
      { ...player, answeredQuestions: new Set(player.answeredQuestions), disconnectTimer: null }
    ])),
    timer: null,
    expiryTimer: null
  };
}

export function hasRoom(code: string): boolean {
  return rooms.has(code);
}

export function forgetRoom(code: string): void {
  rooms.delete(code);
}

export function roomCount(): number {
  return rooms.size;
}

export function availableCategories(): string[] {
  return [...new Set(questionBank.map((question) => question.categoria))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function getRoom(code: unknown): Room | undefined {
  if (typeof code !== 'string' || !/^[A-HJ-NP-Z2-9]{6}$/u.test(code.toUpperCase())) {
    return undefined;
  }
  return rooms.get(code.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateRoomCreationInput(input: unknown): asserts input is {
  categories: string[];
  questionCount: number;
  timePerQuestionSeconds: number;
  nickname: string;
} {
  if (!isRecord(input)) {
    throw new Error('As configurações da partida são inválidas.');
  }
  const { categories, questionCount, timePerQuestionSeconds, nickname } = input;
  const validCategories = availableCategories();
  if (!Array.isArray(categories) || categories.length < 1
      || categories.some((category) => typeof category !== 'string' || !validCategories.includes(category))
      || new Set(categories).size !== categories.length) {
    throw new Error('Selecione pelo menos uma categoria válida.');
  }
  if (typeof questionCount !== 'number' || !Number.isInteger(questionCount) || questionCount < 5 || questionCount > 30) {
    throw new Error('A quantidade de perguntas deve estar entre 5 e 30.');
  }
  if (typeof timePerQuestionSeconds !== 'number' || !Number.isInteger(timePerQuestionSeconds) || timePerQuestionSeconds < 10 || timePerQuestionSeconds > 60) {
    throw new Error('O tempo por pergunta deve estar entre 10 e 60 segundos.');
  }
  const pool = questionBank.filter((question) => categories.includes(question.categoria));
  if (pool.length < questionCount) {
    throw new Error(`As categorias selecionadas têm apenas ${pool.length} perguntas disponíveis.`);
  }
  validateNickname(nickname);
}

export function createRoom(input: unknown, creatorIp = 'unknown', enforceLocalIpLimit = true): { room: Room; player: Player } {
  validateRoomCreationInput(input);
  const { categories, questionCount, timePerQuestionSeconds, nickname } = input;
  if (enforceLocalIpLimit && roomsForIp(creatorIp) >= roomConfig.maxRoomsPerIp) {
    throw new Error('Você atingiu o limite de salas ativas por IP. Tente novamente mais tarde.');
  }

  let code: string;
  do {
    code = Array.from({ length: 6 }, () => ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)]).join('');
  } while (rooms.has(code));

  const player: Player = {
    id: randomUUID(),
    reconnectToken: randomBytes(32).toString('base64url'),
    socketId: null,
    nickname: nickname.trim(),
    points: 0,
    totalAnswerTimeMs: 0,
    answeredQuestions: new Set(),
    answer: null,
    answerReceivedAt: null,
    connected: true,
    disconnectExpiresAt: null,
    disconnectTimer: null
  };
  const room: Room = {
    code,
    creatorIp,
    categories,
    questionCount,
    timePerQuestionSeconds,
    status: 'lobby',
    players: new Map([[player.id, player]]),
    masterId: player.id,
    questions: [],
    questionIndex: -1,
    countdownEndsAt: null,
    questionOpenedAt: null,
    questionEndsAt: null,
    nextActionAt: null,
    expiryAt: null,
    timer: null,
    expiryTimer: null
  };
  rooms.set(code, room);
  return { room, player };
}

export function validateNickname(nickname: unknown): asserts nickname is string {
  if (typeof nickname !== 'string') {
    throw new Error('Informe um nickname válido.');
  }
  const trimmed = nickname.trim();
  const characterCount = [...trimmed].length;
  if (trimmed !== nickname || characterCount < 2 || characterCount > 20 || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
    throw new Error('O nickname deve ter de 2 a 20 caracteres, sem espaços nas pontas.');
  }
}

export function joinRoom(room: Room, nickname: string): Player {
  if (room.status !== 'lobby') {
    throw new Error('Esta partida já começou e não aceita novas entradas.');
  }
  if (room.players.size >= roomConfig.maxPlayersPerRoom) {
    throw new Error(`Esta sala atingiu o limite de ${roomConfig.maxPlayersPerRoom} jogadores.`);
  }
  validateNickname(nickname);
  if ([...room.players.values()].some((player) => player.nickname.toLocaleLowerCase('pt-BR') === nickname.toLocaleLowerCase('pt-BR'))) {
    throw new Error('Esse nickname já está em uso nesta sala.');
  }
  const player: Player = {
    id: randomUUID(),
    reconnectToken: randomBytes(32).toString('base64url'),
    socketId: null,
    nickname,
    points: 0,
    totalAnswerTimeMs: 0,
    answeredQuestions: new Set(),
    answer: null,
    answerReceivedAt: null,
    connected: true,
    disconnectExpiresAt: null,
    disconnectTimer: null
  };
  room.players.set(player.id, player);
  return player;
}

export function rejoinRoom(room: Room, playerId: unknown, token: unknown): Player {
  if (typeof playerId !== 'string' || typeof token !== 'string' || token.length !== 43) {
    throw new Error('Os dados de reconexão são inválidos.');
  }
  const player = room.players.get(playerId);
  if (!player) {
    throw new Error('A vaga não pode ser recuperada. Entre em contato com o mestre.');
  }
  const expected = Buffer.from(player.reconnectToken);
  const received = Buffer.from(token);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('A vaga não pode ser recuperada. Entre em contato com o mestre.');
  }
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
  }
  player.connected = true;
  player.disconnectExpiresAt = null;
  return player;
}

export function schedulePlayerRemoval(room: Room, player: Player, delayMs: number, onExpire: () => void): void {
  if (player.disconnectTimer) {
    clearTimeout(player.disconnectTimer);
  }
  player.disconnectExpiresAt = Date.now() + delayMs;
  player.disconnectTimer = setTimeout(() => {
    if (room.players.get(player.id) !== player || player.socketId !== null) {
      return;
    }
    player.disconnectTimer = null;
    player.disconnectExpiresAt = null;
    room.players.delete(player.id);
    onExpire();
  }, delayMs);
}

export function roomsForIp(ip: string): number {
  let total = 0;
  for (const room of rooms.values()) {
    if (room.creatorIp === ip) {
      total += 1;
    }
  }
  return total;
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
  const question = room.status === 'question' || room.status === 'reveal' ? publicQuestion(room) : null;
  const currentPlayer = room.players.get(viewerId);
  const currentQuestion = room.questions[room.questionIndex];
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
    question,
    countdownEndsAt: room.status === 'countdown' ? room.countdownEndsAt : null,
    correctIndex: room.status === 'reveal' ? currentQuestion?.correta ?? null : null,
    selectedAnswer: currentPlayer?.answer ?? null,
    answerCorrect: room.status === 'reveal' && currentQuestion
      ? currentPlayer?.answer === currentQuestion.correta
      : null,
    ranking: room.status === 'finished' ? finalRanking(room) : null
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
  if (room.expiryTimer) {
    clearTimeout(room.expiryTimer);
  }
  for (const player of room.players.values()) {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
    }
  }
  rooms.delete(room.code);
}

export function scheduleRoomExpiry(room: Room, delayMs: number, onExpire: () => void): void {
  if (room.expiryTimer) {
    clearTimeout(room.expiryTimer);
  }
  room.expiryAt = Date.now() + delayMs;
  room.expiryTimer = setTimeout(() => {
    if (getRoom(room.code) !== room) {
      return;
    }
    room.expiryAt = null;
    onExpire();
    closeRoom(room);
  }, delayMs);
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
