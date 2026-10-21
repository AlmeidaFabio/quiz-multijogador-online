import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Question, QuestionType } from './types.ts';

const questionsDirectory = fileURLToPath(new URL('../data/questions/', import.meta.url));

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

/**
 * Valida o conteúdo de um arquivo de categoria: um array não vazio de perguntas
 * da mesma categoria. O nome do arquivo aparece nas mensagens de erro.
 */
export function validateQuestionFile(fileName: string, value: unknown): asserts value is Question[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fileName} deve conter um array JSON não vazio de perguntas.`);
  }

  const questions: Question[] = [];
  for (const [index, question] of value.entries()) {
    if (!isQuestion(question)) {
      throw new Error(`Pergunta inválida em ${fileName}, posição ${index}.`);
    }
    questions.push(question);
  }

  const categories = new Set(questions.map((question) => question.categoria));
  if (categories.size > 1) {
    throw new Error(`${fileName} mistura as categorias ${[...categories].join(', ')}. Cada arquivo deve conter apenas uma categoria.`);
  }
}

/**
 * Valida o banco completo: ids únicos e pelo menos 5 perguntas por categoria.
 */
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

function readQuestionFile(fileName: string): Question[] {
  const filePath = join(questionsDirectory, fileName);
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    throw new Error(`Não foi possível ler o arquivo de perguntas ${fileName}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`${fileName} não contém um JSON válido.`);
  }

  validateQuestionFile(fileName, parsed);
  return parsed;
}

/**
 * Carrega todos os arquivos .json de `data/questions`. Para adicionar uma
 * categoria nova, basta criar um arquivo novo na pasta.
 */
function loadQuestionBank(): Question[] {
  let entries: string[];
  try {
    entries = readdirSync(questionsDirectory);
  } catch {
    throw new Error(`Não foi possível ler o diretório de perguntas: ${questionsDirectory}`);
  }

  const fileNames = entries
    .filter((entry) => entry.toLowerCase().endsWith('.json'))
    .sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (fileNames.length === 0) {
    throw new Error(`Nenhum arquivo .json de perguntas encontrado em ${questionsDirectory}.`);
  }

  return fileNames.flatMap(readQuestionFile);
}

const loadedQuestionBank = loadQuestionBank();
validateQuestionBank(loadedQuestionBank);
export const questionBank = loadedQuestionBank;
