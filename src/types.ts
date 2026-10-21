import type { AvatarId } from '../shared/avatars.ts';

export type Stage =
  | 'home'
  | 'configuring'
  | 'recovering'
  | 'joining'
  | 'queue'
  | 'lobby'
  | 'countdown'
  | 'question'
  | 'reveal'
  | 'ranking'
  | 'invalid';

export type PlayerSummary = {
  id: string;
  nickname: string;
  avatar: string;
  points: number;
  isMaster: boolean;
};

export type Question = {
  id: string;
  categoria: string;
  tipo: 'multipla_escolha' | 'verdadeiro_falso';
  enunciado: string;
  alternativas: string[];
  number: number;
  total: number;
  endsAt: number;
};

export type RankingRow = PlayerSummary & {
  position: number;
  totalAnswerTimeMs: number;
};

export type RoomState = {
  code: string;
  status: string;
  players: PlayerSummary[];
  playerCount: number;
  isMaster: boolean;
  questionCount: number;
  questionIndex: number;
  timePerQuestionSeconds: number;
  question: Question | null;
  countdownEndsAt: number | null;
  correctIndex: number | null;
  selectedAnswer: number | null;
  answerCorrect: boolean | null;
  ranking: RankingRow[] | null;
};

export type GameConfig = {
  categories: string[];
  questionCounts: Record<string, number>;
  limits: {
    minQuestions: number;
    maxQuestions: number;
    minTimeSeconds: number;
    maxTimeSeconds: number;
    maxPlayersPerRoom: number;
  };
};

export type ServerAck = {
  ok: boolean;
  message?: string;
  code?: string;
  errorCode?: string;
  playerId?: string;
  reconnectToken?: string;
  queued?: boolean;
  position?: number;
  total?: number;
};

export type SavedSession = {
  playerId: string;
  reconnectToken: string;
  nickname: string;
};

export type PresentationTheme = 'classic' | 'midnight' | 'neon';

export type PresentationSettings = {
  theme: PresentationTheme;
  soundEnabled: boolean;
  motionEnabled: boolean;
};

export type RoomCreationRequest = {
  categories: string[];
  questionCount: number;
  timePerQuestionSeconds: number;
  nickname: string;
  avatar: AvatarId;
};
