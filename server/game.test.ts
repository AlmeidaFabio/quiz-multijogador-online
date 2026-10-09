import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerQuestion,
  closeRoom,
  createRoom,
  finalRanking,
  joinRoom,
  publicQuestion,
  rejoinRoom,
  deserializeRoom,
  revealAnswers,
  roomSnapshot,
  roomsForIp,
  serializeRoom,
  schedulePlayerRemoval,
  scheduleRoomExpiry,
  startGame
} from './game.ts';
import { questionBank, validateQuestionBank } from './questions.ts';

function makeRoom(nickname = 'Jogadora') {
  return createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname
  }).room;
}

test('creates a room with an opaque code and the master as its first player', () => {
  const room = makeRoom('Mestre');
  try {
    assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal(room.players.size, 1);
    assert.equal(room.players.get(room.masterId)?.nickname, 'Mestre');
  } finally {
    closeRoom(room);
  }
});

test('accepts players up to the configured per-room limit and rejects the next player', () => {
  const room = makeRoom('Mestre');
  try {
    for (let index = 1; index < 500; index += 1) {
      joinRoom(room, `Jogador ${index}`);
    }
    assert.equal(room.players.size, 500);
    assert.throws(() => joinRoom(room, 'Jogador excedente'), /limite de 500 jogadores/);
    assert.equal(room.players.size, 500);
  } finally {
    closeRoom(room);
  }
});

test('serializes shared room state without process-local timers', () => {
  const { room, player } = createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname: 'Mestre'
  });
  try {
    player.answeredQuestions.add('fil-0001');
    room.nextActionAt = Date.now() + 5000;
    room.expiryAt = Date.now() + 60_000;
    const restored = deserializeRoom(serializeRoom(room));
    const restoredPlayer = restored.players.get(player.id);
    assert.ok(restoredPlayer);
    assert.ok(restored.players instanceof Map);
    assert.ok(restoredPlayer.answeredQuestions instanceof Set);
    assert.deepEqual([...restoredPlayer.answeredQuestions], ['fil-0001']);
    assert.equal(restored.nextActionAt, room.nextActionAt);
    assert.equal(restored.expiryAt, room.expiryAt);
    assert.equal(restored.timer, null);
    assert.equal(restoredPlayer.disconnectTimer, null);
  } finally {
    closeRoom(room);
  }
});

test('rejects an invalid nickname and impossible question configuration', () => {
  assert.throws(() => createRoom({
    categories: ['Filmes'],
    questionCount: 7,
    timePerQuestionSeconds: 10,
    nickname: 'Player'
  }), /apenas 6 perguntas disponíveis/);
  assert.throws(() => createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname: ' x'
  }), /nickname deve ter/);
});

test('rejects malformed question data when validating the server bank', () => {
  assert.throws(() => validateQuestionBank([...questionBank, questionBank[0]]), /ID duplicado/);
  assert.throws(() => validateQuestionBank([{ ...questionBank[0], correta: 99 }]), /Pergunta inválida/);
});

test('enforces the active room limit per creator IP and releases capacity when rooms close', () => {
  const rooms = Array.from({ length: 5 }, (_, index) => createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname: `Mestre ${index}`
  }, '192.0.2.10').room);
  try {
    assert.equal(roomsForIp('192.0.2.10'), 5);
    assert.throws(() => createRoom({
      categories: ['Filmes'],
      questionCount: 5,
      timePerQuestionSeconds: 10,
      nickname: 'Mestre extra'
    }, '192.0.2.10'), /limite de salas ativas/);
    closeRoom(rooms[0]);
    assert.equal(roomsForIp('192.0.2.10'), 4);
  } finally {
    for (const room of rooms) closeRoom(room);
  }
});

test('rejoins an existing player only with its secret browser token', () => {
  const { room, player } = createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname: 'Mestre'
  });
  try {
    assert.equal(rejoinRoom(room, player.id, player.reconnectToken), player);
    assert.throws(() => rejoinRoom(room, player.id, 'x'.repeat(43)), /vaga não pode ser recuperada/);
    assert.throws(() => rejoinRoom(room, 'unknown-player', player.reconnectToken), /vaga não pode ser recuperada/);
  } finally {
    closeRoom(room);
  }
});

test('preserves a disconnected player during the grace period and removes them after it', async () => {
  const { room, player } = createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname: 'Mestre'
  });
  player.socketId = null;
  player.connected = false;
  let removed = false;
  const removal = new Promise<void>((resolve) => {
    schedulePlayerRemoval(room, player, 5, () => {
      removed = true;
      resolve();
    });
  });
  assert.equal(room.players.has(player.id), true);
  await removal;
  assert.equal(removed, true);
  assert.equal(room.players.has(player.id), false);
  assert.throws(() => rejoinRoom(room, player.id, player.reconnectToken), /vaga não pode ser recuperada/);
  closeRoom(room);
});

test('cancels pending removal when the player reconnects during the grace period', async () => {
  const { room, player } = createRoom({
    categories: ['Filmes'],
    questionCount: 5,
    timePerQuestionSeconds: 10,
    nickname: 'Mestre'
  });
  player.socketId = null;
  player.connected = false;
  schedulePlayerRemoval(room, player, 20, () => assert.fail('reconnected player should not be removed'));
  assert.equal(rejoinRoom(room, player.id, player.reconnectToken), player);
  player.socketId = 'reconnected-socket';
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(room.players.has(player.id), true);
  assert.equal(player.connected, true);
  closeRoom(room);
});

test('room expiry closes the room and runs its expiration callback', async () => {
  const room = makeRoom();
  let expired = false;
  const expiry = new Promise<void>((resolve) => {
    scheduleRoomExpiry(room, 5, () => {
      expired = true;
      resolve();
    });
  });
  await expiry;
  assert.equal(expired, true);
  assert.equal(roomsForIp('unknown'), 0);
});

test('starts with distinct questions and never exposes the answer key early', () => {
  const room = makeRoom();
  try {
    startGame(room);
    assert.equal(room.questions.length, 5);
    assert.equal(new Set(room.questions.map((question) => question.id)).size, 5);
    room.questionIndex = 0;
    room.questionOpenedAt = Date.now();
    room.questionEndsAt = Date.now() + 10_000;
    room.status = 'question';
    const safeQuestion = publicQuestion(room);
    assert.ok(safeQuestion);
    assert.equal('correta' in safeQuestion, false);
  } finally {
    closeRoom(room);
  }
});

test('accepts only the first in-time answer and scores correct answers on the server', () => {
  const room = makeRoom();
  try {
    startGame(room);
    room.questionIndex = 0;
    room.questionOpenedAt = Date.now();
    room.questionEndsAt = Date.now() + 10_000;
    room.status = 'question';
    const player = room.players.get(room.masterId)!;
    const rightAnswer = room.questions[0].correta;
    answerQuestion(room, player, rightAnswer);
    assert.throws(() => answerQuestion(room, player, rightAnswer), /já respondeu/);
    const [result] = revealAnswers(room);
    assert.equal(result.correct, true);
    assert.ok(player.points >= 500 && player.points <= 1000);
    assert.ok(player.totalAnswerTimeMs < 10_000);
    room.status = 'reveal';
    const restored = roomSnapshot(room, player.id);
    assert.equal(restored.selectedAnswer, rightAnswer);
    assert.equal(restored.correctIndex, rightAnswer);
    assert.equal(restored.answerCorrect, true);
  } finally {
    closeRoom(room);
  }
});

test('uses the maximum question time for wrong or unanswered tie-breaks', () => {
  const room = makeRoom();
  try {
    startGame(room);
    room.questionIndex = 0;
    room.questionOpenedAt = Date.now();
    room.questionEndsAt = Date.now() + 10_000;
    room.status = 'question';
    const [player] = [...room.players.values()];
    const wrongAnswer = (room.questions[0].correta + 1) % room.questions[0].alternativas.length;
    answerQuestion(room, player, wrongAnswer);
    revealAnswers(room);
    assert.equal(player.points, 0);
    assert.equal(player.totalAnswerTimeMs, 10_000);
    assert.equal(finalRanking(room)[0].position, 1);
  } finally {
    closeRoom(room);
  }
});
