import { availableCategories, questionBank } from '../server/game.ts';

console.log(`Banco válido: ${questionBank.length} perguntas carregadas em ${availableCategories().length} categorias.`);
for (const category of availableCategories()) {
  const total = questionBank.filter((question) => question.categoria === category).length;
  console.log(`- ${category}: ${total} perguntas`);
}
