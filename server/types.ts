export type QuestionType = 'multipla_escolha' | 'verdadeiro_falso';
export type RoomStatus = 'lobby' | 'countdown' | 'question' | 'reveal' | 'finished';

export interface Question {
  id: string;
  categoria: string;
  tipo: QuestionType;
  enunciado: string;
  alternativas: string[];
  correta: number;
}

export interface PublicQuestion extends Omit<Question, 'correta'> {
  number: number;
  total: number;
  endsAt: number;
}

export interface Player {
  id: string;
  nickname: string;
  points: number;
  totalAnswerTimeMs: number;
  answeredQuestions: Set<string>;
  answer: number | null;
  answerReceivedAt: number | null;
  connected: boolean;
}

export interface Room {
  code: string;
  categories: string[];
  questionCount: number;
  timePerQuestionSeconds: number;
  status: RoomStatus;
  players: Map<string, Player>;
  masterId: string;
  questions: Question[];
  questionIndex: number;
  questionOpenedAt: number | null;
  questionEndsAt: number | null;
  timer: NodeJS.Timeout | null;
}

export interface PlayerSummary {
  id: string;
  nickname: string;
  points: number;
  isMaster: boolean;
}

export interface RoomSnapshot {
  code: string;
  status: RoomStatus;
  players: PlayerSummary[];
  playerCount: number;
  isMaster: boolean;
  questionCount: number;
  questionIndex: number;
  timePerQuestionSeconds: number;
  question: PublicQuestion | null;
}
