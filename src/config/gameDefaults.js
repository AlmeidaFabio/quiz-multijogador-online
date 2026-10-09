module.exports = {
  product: {
    name: 'Quiz Interativo Multijogador',
    locale: 'pt-BR',
    requiresAccount: false,
    responsivePriority: 'mobile-first'
  },
  room: {
    maxRoomsPerIp: 5,
    roomCodeLength: 6,
    allowMultiCategory: true,
    autoCloseAfterInactivityMs: 15 * 60 * 1000,
    allowMasterRejoinSameBrowser: true,
    showPartialRankingOnEarlyEnd: true,
    closeLobbyOnStart: true
  },
  player: {
    nickname: {
      minLength: 2,
      maxLength: 20,
      trimWhitespace: true,
      disallowLeadingOrTrailingSpaces: true,
      allowSpacesInside: true
    }
  },
  question: {
    minQuestionsPerMatch: 5,
    maxQuestionsPerMatch: 30,
    minTimePerQuestionSeconds: 10,
    maxTimePerQuestionSeconds: 60,
    defaultTimePerQuestionSeconds: 20,
    categories: ['Filmes', 'Séries', 'Esportes']
  },
  scoring: {
    basePoints: 500,
    maxPoints: 1000,
    formula: 'P = 500 + 500 * ((T - t) / T)',
    wrongAnswerPoints: 0,
    tieBreaker: 'menor tempo total de resposta',
    unansweredQuestionTime: 'tempo máximo T'
  },
  security: {
    serverSideValidation: true,
    rateLimit: {
      joinRoom: '1 req/s',
      createRoom: '1 req/s'
    },
    nicknameModeration: 'fora do MVP'
  }
};
