import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { questionBank, validateQuestionFile } from './questions.ts';

test('carrega as perguntas de todos os arquivos de categoria', () => {
  const directory = fileURLToPath(new URL('../data/questions/', import.meta.url));
  const fileNames = readdirSync(directory).filter((name) => name.endsWith('.json'));
  assert.ok(fileNames.length > 0);

  const expectedCategories = new Set<string>();
  for (const fileName of fileNames) {
    const questions = JSON.parse(readFileSync(join(directory, fileName), 'utf8')) as Array<{ categoria: string }>;
    assert.ok(questions.length >= 5, `${fileName} precisa ter ao menos 5 perguntas`);
    for (const question of questions) {
      expectedCategories.add(question.categoria);
    }
  }

  assert.ok(questionBank.length > 0);
  const loadedCategories = new Set(questionBank.map((question) => question.categoria));
  assert.deepEqual(
    [...loadedCategories].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [...expectedCategories].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  );
  assert.equal(new Set(questionBank.map((question) => question.id)).size, questionBank.length);
});

test('rejeita um arquivo que mistura categorias', () => {
  const [first, second] = questionBank;
  assert.throws(
    () => validateQuestionFile('misto.json', [first, { ...second, categoria: 'Outra categoria' }]),
    /mistura as categorias/
  );
});

test('rejeita um arquivo vazio ou fora do formato', () => {
  assert.throws(() => validateQuestionFile('vazio.json', []), /array JSON não vazio/);
  assert.throws(() => validateQuestionFile('objeto.json', { perguntas: [] }), /array JSON não vazio/);
});

test('indica o arquivo e a posição da pergunta inválida', () => {
  assert.throws(
    () => validateQuestionFile('quebrado.json', [{ ...questionBank[0], correta: 99 }]),
    /Pergunta inválida em quebrado\.json, posição 0/
  );
});
