import source from '../data/questions.json' with { type: 'json' };
import type { Question, QuestionType } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuestionType(value: unknown): value is QuestionType {
  return value === 'multipla_escolha' || value === 'verdadeiro_falso';
}

function isQuestion(value: unknown): value is Question {
  if (!isRecord(value)) {
    return false;
  }
  const alternatives = value.alternativas;
  if (!Array.isArray(alternatives) || !alternatives.every((alternative) => typeof alternative === 'string' && alternative.trim().length > 0)) {
    return false;
  }
  const type = value.tipo;
  const correctIndex = value.correta;
  return typeof value.id === 'string'
    && value.id.trim().length > 0
    && typeof value.categoria === 'string'
    && value.categoria.trim().length > 0
    && isQuestionType(type)
    && typeof value.enunciado === 'string'
    && value.enunciado.trim().length > 0
    && typeof correctIndex === 'number'
    && Number.isInteger(correctIndex)
    && correctIndex >= 0
    && correctIndex < alternatives.length
    && (type === 'multipla_escolha' ? alternatives.length >= 3 && alternatives.length <= 5 : alternatives.length === 2);
}

export function validateQuestionBank(value: unknown): asserts value is Question[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('O banco de perguntas deve ser um array JSON não vazio.');
  }

  const ids = new Set<string>();
  const categoryCounts = new Map<string, number>();
  for (const [index, question] of value.entries()) {
    if (!isQuestion(question)) {
      throw new Error(`Pergunta inválida na posição ${index}.`);
    }
    if (ids.has(question.id)) {
      throw new Error(`ID duplicado encontrado: ${question.id}`);
    }
    ids.add(question.id);
    categoryCounts.set(question.categoria, (categoryCounts.get(question.categoria) ?? 0) + 1);
  }

  for (const [category, count] of categoryCounts) {
    if (count < 5) {
      throw new Error(`A categoria ${category} precisa ter ao menos 5 perguntas para permitir iniciar uma partida.`);
    }
  }
}

const unvalidatedSource: unknown = source;
validateQuestionBank(unvalidatedSource);
export const questionBank = unvalidatedSource;
