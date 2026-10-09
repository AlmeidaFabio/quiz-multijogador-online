# Quiz Interativo Multijogador

MVP do quiz online descrito em [docs/PRD — Quiz Interativo Multijogador.md](docs/PRD%20%E2%80%94%20Quiz%20Interativo%20Multijogador.md).

## Fases concluídas

- **Fase 0:** decisões iniciais, banco de perguntas e validador.
- Banco de perguntas ampliado para seis categorias: Animes, Esportes, Filmes, Geografia, Música e Séries.
- **Fase 1:** criação de sala, convite, nickname, lobby em tempo real, contagem regressiva, perguntas com cronômetro autoritativo no servidor, pontuação, ranking e encerramento pelo mestre.
- **Fase 2:** reconexão autenticada no mesmo navegador, restauração do estado atual, expiração de salas, retorno à home no encerramento, limite de salas por IP, rate limits e validação de payloads.
- **Fase 3:** estado serializável das partidas compartilhado no Redis, coordenação de mutações entre instâncias, broadcast Socket.IO via Redis, recuperação de timers, limite global configurável e teste de carga reproduzível.
- Fila FIFO compartilhada para criação de salas: ao atingir o limite, o usuário pode aceitar a fila; sua sala é criada automaticamente quando uma vaga abre. Desconectar remove o pedido.
- Reconexão disponível durante 60 segundos após a queda; depois desse prazo, o jogador é removido e sua vaga não pode ser recuperada.

## Tecnologias

- React, Vite e TypeScript no cliente.
- Node.js, Fastify e Socket.IO no servidor.
- Redis para estado compartilhado das salas, locks distribuídos e distribuição de eventos entre instâncias.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm run dev
```

Abra `http://localhost:5173`. O servidor HTTP e Socket.IO fica em `http://localhost:3000`.

Sem `REDIS_URL`, o servidor usa armazenamento em memória para desenvolvimento com uma única instância. Para executar com Redis:

```powershell
docker compose up -d redis
$env:REDIS_URL = "redis://localhost:6379"
npm run dev
```

Configure a mesma `REDIS_URL` em todas as instâncias para compartilhar partidas e eventos. O proxy/load balancer deve manter afinidade de conexão para transportes Socket.IO com polling; clientes WebSocket podem ser distribuídos diretamente.

O limite padrão é de **5 salas simultâneas** (`MAX_CONCURRENT_ROOMS`) e **500 jogadores por sala**, incluindo o mestre (`MAX_PLAYERS_PER_ROOM`). Ao atingir o limite de participantes, novas entradas recebem uma mensagem clara. Quando o limite global de salas é atingido, o usuário pode entrar na fila FIFO para criação de sala, limitada a 500 pedidos por padrão (`MAX_ROOM_CREATION_QUEUE`). A criação usa as configurações enviadas originalmente; o usuário pode sair da fila a qualquer momento e é removido dela se desconectar. O limite de cinco salas por IP pode ser ajustado com `MAX_ROOMS_PER_IP`. O prazo de inatividade (15 minutos), a retenção do ranking (1 minuto) e a janela de reconexão do jogador (60 segundos) podem ser ajustados com `ROOM_INACTIVITY_TIMEOUT_MS`, `RANKING_RETENTION_MS` e `PLAYER_RECONNECT_GRACE_MS`, respectivamente.

Nicknames são moderados no servidor ao criar uma sala, entrar nela ou solicitar uma sala pela fila. Palavrões e termos ofensivos comuns são bloqueados mesmo com acentos, separadores ou substituições simples por números/símbolos. A lista é uma proteção básica, não uma garantia de detecção de todas as ofensas ou variações.

## Teste de carga

O perfil de carga já executado foi de 10 salas com 50 jogadores cada (500 conexões), com meta de p95 inferior a 500 ms para atualização do lobby e entrega das perguntas. Esse resultado **não valida** o novo limite de 500 jogadores em uma sala nem 2.500 conexões simultâneas. O teste executa uma partida de cinco perguntas em cada sala. Para reproduzir o perfil anterior de carga em duas instâncias locais, inicie-as com o mesmo Redis e configure limites de salas/rate maiores **somente nos processos isolados de teste**, pois todos os clientes locais compartilham o mesmo IP:

```powershell
docker compose up -d redis
$env:REDIS_URL = "redis://localhost:6379"
$env:MAX_CONCURRENT_ROOMS = "10"
$env:MAX_PLAYERS_PER_ROOM = "500"
$env:CREATE_ROOM_PER_IP_RATE_LIMIT = "20"
$env:JOIN_ROOM_PER_IP_RATE_LIMIT = "500"
$env:START_GAME_PER_IP_RATE_LIMIT = "20"
$env:MAX_ROOMS_PER_IP = "20"
$env:PORT = "3000"
npm start
```

Inicie a segunda instância em outro terminal, alterando `PORT` para `3001` e mantendo os mesmos limites e `REDIS_URL`. Em um terceiro terminal:

```powershell
$env:LOAD_TEST_URLS = "http://localhost:3000,http://localhost:3001"
npm run test:load
```

O script imprime as medições, confirma a rejeição de uma sala adicional quando o perfil alcança `LOAD_TEST_MAX_CONCURRENT_ROOMS` (10 por padrão) e retorna código diferente de zero se o p95 exceder `LOAD_TEST_TARGET_LATENCY_MS` (500 ms por padrão). Número de salas, jogadores por sala, limite esperado e meta podem ser alterados com `LOAD_TEST_ROOMS`, `LOAD_TEST_PLAYERS_PER_ROOM`, `LOAD_TEST_MAX_CONCURRENT_ROOMS` e `LOAD_TEST_TARGET_LATENCY_MS`. Uma validação de 500 jogadores em uma única sala deve ser executada antes de tratar essa capacidade como desempenho comprovado.

Execução local anterior ao novo padrão, validada com duas instâncias e Redis 7: 500/500 conexões, rejeição confirmada da 11ª sala, 2.500 eventos de pergunta, p95 de 25 ms para o estado após entrada e 31 ms para entrega de pergunta; as partidas terminaram em 66 s (74 s totais). A medição foi feita em uma máquina e serve como baseline reproduzível, não como garantia de desempenho da infraestrutura de produção, especialmente para 500 jogadores em uma sala.

## Validar

```bash
npm test
npm run validate:questions
npm run build
```

O banco `data/questions.json` é importado apenas pelo servidor. O campo `correta` não é enviado ao cliente até o fim do tempo da pergunta.

## Limites desta fase

O conteúdo do jogo continua efêmero: o Redis mantém o estado das salas ativas e não é um histórico de partidas. Sem Redis, o estado fica limitado ao processo local e se perde quando ele reinicia. Os limites iniciais de cinco salas e 500 jogadores por sala são configuráveis e devem ser reavaliados após teste na infraestrutura de produção.
