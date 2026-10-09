# Quiz Interativo Multijogador

MVP do quiz online descrito em [docs/PRD — Quiz Interativo Multijogador.md](docs/PRD%20%E2%80%94%20Quiz%20Interativo%20Multijogador.md).

## Fases concluídas

- **Fase 0:** decisões iniciais, banco de perguntas e validador.
- **Fase 1:** criação de sala, convite, nickname, lobby em tempo real, contagem regressiva, perguntas com cronômetro autoritativo no servidor, pontuação, ranking e encerramento pelo mestre.
- **Fase 2:** reconexão autenticada no mesmo navegador, restauração do estado atual, expiração de salas, retorno à home no encerramento, limite de salas por IP, rate limits e validação de payloads.
- Reconexão disponível durante 60 segundos após a queda; depois desse prazo, o jogador é removido e sua vaga não pode ser recuperada.

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

O limite de cinco salas simultâneas por IP pode ser ajustado com `MAX_ROOMS_PER_IP`. O prazo de inatividade (15 minutos), a retenção do ranking (1 minuto) e a janela de reconexão do jogador (60 segundos) podem ser ajustados com `ROOM_INACTIVITY_TIMEOUT_MS`, `RANKING_RETENTION_MS` e `PLAYER_RECONNECT_GRACE_MS`, respectivamente.

## Validar

```bash
npm test
npm run validate:questions
npm run build
```

O banco `data/questions.json` é importado apenas pelo servidor. O campo `correta` não é enviado ao cliente até o fim do tempo da pergunta.

## Limites desta fase

O estado continua volátil e se perde ao reiniciar o servidor. Reconexão recupera a vaga apenas no mesmo navegador enquanto o processo do servidor mantiver a sala. Persistência/estado compartilhado entre instâncias continua reservado para a fase de escala.
