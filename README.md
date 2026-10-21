<div align="center">

# Quiz Interativo Multijogador

**Crie uma sala, convide seus amigos e descubra quem sabe mais.**

Um quiz online em tempo real com lobby, partidas sincronizadas e ranking ao final.

![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

</div>

## Sobre o projeto

O Quiz Interativo Multijogador permite criar salas para jogar com outras pessoas em tempo real. O mestre inicia a partida, os participantes respondem às perguntas dentro do tempo e todos acompanham a pontuação e o ranking.

### O que já está disponível

- Salas com convite, nickname, lobby em tempo real e início controlado pelo mestre.
- Avatares: 12 opções de escolha para cada jogador, exibidas no lobby, no pódio e no ranking.
- Perguntas com cronômetro autoritativo no servidor, pontuação e ranking final.
- Dez categorias: animes, ciências, esportes, filmes, games, geografia, história, música, séries e super nerd.
- Reconexão autenticada no mesmo navegador, com restauração da partida por até 60 segundos.
- Fila FIFO para criação de salas quando o limite de salas simultâneas é atingido.
- Redis para compartilhar partidas e eventos entre instâncias; modo em memória para desenvolvimento local.
- Temas Clássico, Noite e Neon (Neon é o padrão), selecionados por ícones e salvos no navegador.
- Sons sintetizados e animações de jogo, com controles de som e de movimento.
- Respostas por toque ou pelas teclas A–D no desktop.
- Interface responsiva e controle de sons.

## Tecnologias

| Área | Tecnologias |
| --- | --- |
| Cliente | React, Vite e TypeScript |
| Servidor | Node.js, Fastify e Socket.IO |
| Escala horizontal | Redis e adaptador Redis do Socket.IO |

## Comece a jogar localmente

**Requisitos:** Node.js 20 ou superior e npm.

```bash
npm install
npm run dev
```

Abra **http://localhost:5173**. O servidor HTTP e Socket.IO fica em **http://localhost:3000**.

Por padrão, o servidor mantém o estado em memória, adequado para desenvolvimento com uma única instância. Para usar Redis localmente:

```powershell
docker compose up -d redis
$env:REDIS_URL = "redis://localhost:6379"
npm run dev
```

Configure a mesma `REDIS_URL` em todas as instâncias para compartilhar partidas e eventos. Com polling, o proxy ou load balancer deve manter afinidade de conexão; clientes WebSocket podem ser distribuídos diretamente.

## Configurações e limites

| Configuração | Padrão | Descrição |
| --- | ---: | --- |
| `MAX_CONCURRENT_ROOMS` | 5 | Salas simultâneas |
| `MAX_PLAYERS_PER_ROOM` | 500 | Participantes por sala, incluindo o mestre |
| `MAX_ROOM_CREATION_QUEUE` | 500 | Pedidos na fila de criação |
| `MAX_ROOMS_PER_IP` | 5 | Limite de salas por IP |
| `ROOM_INACTIVITY_TIMEOUT_MS` | 15 min | Prazo de inatividade da sala |
| `RANKING_RETENTION_MS` | 1 min | Retenção do ranking após a partida |
| `PLAYER_RECONNECT_GRACE_MS` | 60 s | Prazo para reconexão do jogador |

Ao atingir o limite de salas, o usuário pode aceitar entrar na fila FIFO. A sala é criada quando uma vaga abre; o pedido pode ser cancelado e é removido se o usuário desconectar. O limite de participantes por sala e os limites de taxa também são validados no servidor.

Nicknames são moderados ao criar ou entrar em uma sala e ao solicitar uma sala pela fila. A filtragem cobre termos ofensivos comuns, inclusive algumas variações, mas não garante detectar todas as ofensas.

## Verificações

```bash
npm test
npm run validate:questions
npm run build
```

O banco de perguntas fica em `data/questions/`, com um arquivo por categoria (por exemplo, `animes.json`, `games.json`, `historia.json` e `ciencias.json`). O servidor lê todos os `.json` da pasta na inicialização, então para adicionar uma categoria basta criar um arquivo novo com um array de perguntas. Cada arquivo deve conter apenas uma categoria e cada categoria precisa de pelo menos 5 perguntas. O banco é lido apenas pelo servidor, e a resposta correta não é enviada ao cliente até o fim do tempo da pergunta.

## Teste de carga

O perfil reproduzível configura 10 salas com 50 jogadores cada (500 conexões), com meta de p95 abaixo de 500 ms para atualizações do lobby e entrega das perguntas. A execução simula uma partida de cinco perguntas por sala.

Para executar em duas instâncias locais com Redis, inicie a primeira instância:

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

Em outro terminal, inicie a segunda instância na porta `3001`, mantendo as mesmas configurações. Em um terceiro terminal, execute o teste:

```powershell
$env:LOAD_TEST_URLS = "http://localhost:3000,http://localhost:3001"
npm run test:load
```

O teste verifica a rejeição de uma sala adicional e retorna código diferente de zero se o p95 exceder `LOAD_TEST_TARGET_LATENCY_MS` (500 ms por padrão). É possível ajustar o perfil com `LOAD_TEST_ROOMS`, `LOAD_TEST_PLAYERS_PER_ROOM`, `LOAD_TEST_MAX_CONCURRENT_ROOMS` e `LOAD_TEST_TARGET_LATENCY_MS`. Como os clientes compartilham o IP local, os limites de taxa acima devem ser usados apenas nos processos isolados de teste.

Uma execução anterior, com duas instâncias e Redis 7, registrou 500/500 conexões, rejeição da 11ª sala, p95 de 25 ms para atualização do estado após entrada e 31 ms para entrega de pergunta. Foi uma medição em uma única máquina, não uma garantia de produção; ela não valida 500 jogadores em uma sala nem 2.500 conexões simultâneas.

## Limitações conhecidas

- As partidas são efêmeras: o Redis mantém apenas o estado das salas ativas, não um histórico.
- Sem Redis, o estado fica restrito ao processo e é perdido quando ele reinicia.
- O login com Google é apenas indicativo; a autenticação ainda não está implementada.
- A capacidade de 500 jogadores em uma única sala precisa ser testada antes de ser considerada comprovada.
