import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answerQuestion,
  closeRoom,
  createRoom,
  finalRanking,
  publicQuestion,
  revealAnswers,
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
