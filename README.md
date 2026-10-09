# Quiz Interativo Multijogador

MVP do quiz online descrito em [docs/PRD — Quiz Interativo Multijogador.md](docs/PRD%20%E2%80%94%20Quiz%20Interativo%20Multijogador.md).

## Fases concluídas

- **Fase 0:** decisões iniciais, banco de perguntas e validador.
- **Fase 1:** criação de sala, convite, nickname, lobby em tempo real, contagem regressiva, perguntas com cronômetro autoritativo no servidor, pontuação, ranking e encerramento pelo mestre.

## Tecnologias

- React, Vite e TypeScript no cliente.
- Node.js, Fastify e Socket.IO no servidor.
- Estado de salas em memória nesta fase; Redis/armazenamento compartilhado fica para a fase de escala.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. O servidor HTTP e Socket.IO fica em `http://localhost:3000`.

## Validar

```bash
npm test
npm run validate:questions
npm run build
```

O banco `data/questions.json` é importado apenas pelo servidor. O campo `correta` não é enviado ao cliente até o fim do tempo da pergunta.

## Limites desta fase

O estado é volátil e se perde ao reiniciar o servidor. Reconexão com restauração da partida, timeout de salas, rate limiting, limites por IP e encerramento/redirecionamento são trabalho da fase 2.
