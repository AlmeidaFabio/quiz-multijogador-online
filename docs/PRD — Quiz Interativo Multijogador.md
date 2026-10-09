# PRD — Quiz Interativo Multijogador

Oct 8, 2026 · @Fabio Almeida

## 1. Visão geral

O produto é um quiz online em que um grupo joga a mesma partida ao mesmo tempo, cada pessoa no próprio aparelho: vence quem acerta mais e responde mais rápido. É um projeto pessoal com potencial de virar produto, aberto ao público geral.

**Problema:** montar um quiz em grupo costuma exigir cadastro, aplicativo ou tela compartilhada. Aqui, quem cria a sala compartilha um link e todos entram só com um nickname.

**Objetivo do MVP:** permitir que uma pessoa crie uma partida, convide qualquer número de jogadores por link e conduza o jogo até o ranking final, sem login e sem instalar nada.

**Princípios**

- **Entrada sem atrito:** link com código embutido e apenas um nickname.
- **Servidor como fonte da verdade:** tempo, pontuação e gabarito ficam no servidor.
- **Simplicidade no MVP:** sem contas, histórico, sons ou animações.
- **Pensado para celular:** site responsivo, botões grandes, uma ação por tela.

## 2. Papéis

Há dois papéis, e o mestre também é jogador.

| Papel | O que faz | O que não faz |
| --- | --- | --- |
| Mestre | Cria a partida, define categorias, número de perguntas e tempo por pergunta, compartilha o convite, inicia e encerra a partida. Também joga e entra no ranking. | Não expulsa jogadores. A partida segue mesmo se ele desconectar. |
| Jogador | Abre o convite, escolhe um nickname, aguarda no lobby e responde às perguntas. | Não configura nem inicia a partida. |

Nenhum dos dois precisa de conta no MVP. Cada pessoa é identificada por um identificador guardado no navegador, usado na reconexão.

## 3. Escopo

O MVP entrega uma partida completa de ponta a ponta; contas, histórico e acabamento visual ficam para depois.

**Dentro do MVP**

- Criação de partida com configurações e geração de convite (link com código embutido).
- Entrada por nickname, com bloqueio de nickname repetido na sala.
- Lobby em tempo real: avisos de entrada, contador e lista de participantes.
- Início pelo mestre, aviso a todos e contagem regressiva.
- Perguntas de múltipla escolha e verdadeiro/falso, sorteadas sem repetição, iguais para todos.
- Cronômetro por pergunta controlado pelo servidor.
- Revelação da resposta correta ao fim de cada pergunta.
- Ranking final com destaque ao top 3 e desempate por tempo.
- Reconexão no mesmo navegador com pontuação preservada.
- Encerramento pelo mestre ou por tempo limite, com redirecionamento à home.
- Proteções contra abuso: limite de salas por IP e rate limit.
- Moderação básica de nicknames para bloquear palavrões e termos ofensivos comuns.
- Site responsivo.

**Fora do MVP**

- Conta e login do mestre, com dados persistidos (fase seguinte, ver decisões pendentes).
- Histórico de partidas e rankings.
- Sons, animações e feedback visual elaborado.
- Modo equipes, power-ups, chat, salas públicas, exportação de resultados e estatísticas por pergunta.
- Níveis de dificuldade e outros idiomas além do português.

## 4. Fluxo da partida

Uma partida percorre sete etapas, da criação à volta para a home.

1. **Criação:** o mestre escolhe categorias (uma ou várias), número de perguntas e tempo por pergunta, informa seu nickname e cria a sala. O sistema gera o link de convite.
2. **Convite:** o mestre compartilha o link. Quem abre o link vê o código já preenchido, informa o nickname e entra. Nickname já usado na sala exibe aviso e pede outro.
3. **Lobby:** todos veem a lista de participantes, o contador e avisos do tipo "fulano se juntou à partida". Só o mestre vê o botão de iniciar, que pode usar mesmo sozinho.
4. **Início:** ao clicar em iniciar, a sala fecha para novas entradas, todos são avisados e uma contagem regressiva começa.
5. **Perguntas:** para cada pergunta, o servidor sorteia (sem repetir), envia o enunciado e as alternativas e inicia o cronômetro. Cada jogador responde uma única vez. Ao fim do tempo, o servidor revela a resposta correta a todos e passa para a próxima.
6. **Ranking:** após a última pergunta, todos veem o ranking com destaque ao top 3.
7. **Encerramento:** o mestre encerra a partida, ou ela se encerra sozinha após um tempo limite. Em seguida, todos são redirecionados para a home.

## 5. Requisitos funcionais

Os requisitos abaixo cobrem o MVP, agrupados por área.

| ID | Área | Requisito |
| --- | --- | --- |
| RF01 | Sala | O mestre cria uma partida escolhendo uma ou mais categorias, o número de perguntas e o tempo por pergunta. Ao atingir o limite global de salas, pode aceitar uma fila FIFO; a sala é criada automaticamente quando houver capacidade. |
| RF02 | Sala | Ao criar a partida, o sistema gera um link de convite com o código da sala embutido. |
| RF03 | Sala | A sala deixa de aceitar entradas quando o mestre inicia a partida. |
| RF04 | Sala | A partida pode ser iniciada com apenas um participante (o mestre). |
| RF05 | Entrada | O jogador entra informando apenas um nickname, sem cadastro. |
| RF06 | Entrada | Se o nickname já existir na sala, o sistema exibe a mensagem de que já está em uso e não permite a entrada. |
| RF07 | Entrada | Quem abre um convite inválido, expirado ou de sala já iniciada vê uma mensagem clara e um caminho para a home. |
| RF08 | Lobby | A tela de espera mostra a lista de participantes, o contador e avisos em tempo real de quem entrou. |
| RF09 | Lobby | Somente o mestre vê e aciona o botão de iniciar. |
| RF10 | Início | Ao iniciar, todos os participantes são avisados e veem uma contagem regressiva sincronizada. |
| RF11 | Perguntas | As perguntas são sorteadas aleatoriamente das categorias escolhidas, sem repetição na mesma partida. |
| RF12 | Perguntas | Todos os jogadores recebem as mesmas perguntas, na mesma ordem e com as alternativas na mesma ordem. |
| RF13 | Perguntas | Há dois formatos: múltipla escolha e verdadeiro/falso. |
| RF14 | Resposta | Cada jogador envia uma única resposta por pergunta, e ela não pode ser alterada. |
| RF15 | Resposta | O cronômetro de cada pergunta é do servidor; respostas recebidas após o fim do tempo são descartadas. |
| RF16 | Resposta | Quem não responde a tempo recebe 0 pontos e a partida segue. |
| RF17 | Resposta | Ao fim de cada pergunta, todos veem a resposta correta (sem placar parcial). |
| RF18 | Pontuação | Apenas acertos pontuam, com bônus por rapidez (ver seção 6). Erro não pontua nem penaliza. |
| RF19 | Ranking | O ranking final ordena por pontos e desempata pelo menor tempo total de resposta. |
| RF20 | Ranking | O ranking destaca visualmente os três primeiros colocados. |
| RF21 | Reconexão | Quem atualizar a página ou perder a conexão volta à partida no mesmo navegador, com a pontuação preservada. |
| RF22 | Mestre | Se o mestre desconectar, a partida continua normalmente. |
| RF23 | Encerramento | O mestre pode encerrar a partida; sem ação dele, a partida se encerra automaticamente após um tempo limite. |
| RF24 | Encerramento | Ao encerrar, todos são redirecionados para a home e os dados da sala são descartados. |
| RF25 | Abuso | O sistema limita o número de salas criadas por IP e aplica rate limit nas ações dos clientes. |
| RF26 | Sala | A fila de criação de salas é limitada e compartilhada entre instâncias; o usuário pode sair dela, e pedidos de sockets desconectados são removidos. |
| RF27 | Sala | Cada sala aceita até o limite configurado de jogadores (500 por padrão, incluindo o mestre); tentativas adicionais recebem uma mensagem clara. |
| RF28 | Entrada | Nicknames com palavrões ou termos ofensivos comuns são recusados pelo servidor, inclusive quando usam acentos, separadores ou substituições simples por números e símbolos. |

## 6. Regras de jogo e pontuação

Cada acerto vale entre 500 e 1000 pontos: 500 fixos mais um bônus que diminui linearmente com o tempo gasto. Esta é a proposta inicial, ajustável nos testes.

```latex
P = 500 + 500 \times \frac{T - t}{T}
```

Onde T é o tempo total da pergunta e t é o tempo que o jogador levou, medido pelo servidor desde o envio da pergunta até o recebimento da resposta. Resposta errada ou ausente vale P = 0.

Exemplo com T = 20 s:

| Tempo de resposta (t) | Pontos de um acerto |
| --- | --- |
| 0 s | 1000 |
| 5 s | 875 |
| 10 s | 750 |
| 20 s | 500 |

**Desempate:** em pontos iguais, vence quem tiver o menor tempo total de resposta, somando o tempo de todas as perguntas. Pergunta errada ou sem resposta conta o tempo máximo T. Se o empate persistir, os jogadores dividem a posição.

**Medição justa:** como o tempo é do servidor, a latência de cada jogador entra no cálculo. Para o MVP isso é aceitável; um ajuste por latência pode ser avaliado depois.

## 7. Requisitos não funcionais

O ponto mais exigente é o tempo real com muitos jogadores por sala; os valores numéricos abaixo são metas iniciais a validar em teste de carga.

| ID | Área | Requisito |
| --- | --- | --- |
| RNF01 | Tempo real | Comunicação bidirecional por conexão persistente (por exemplo WebSocket), com eventos de lobby, início, pergunta, resposta e fim. |
| RNF02 | Tempo real | Meta de atraso percebido inferior a 500 ms entre um evento do servidor e a tela do jogador em condições normais de rede. |
| RNF03 | Autoridade | O servidor decide quando cada pergunta abre e fecha, valida respostas e calcula a pontuação. O cliente só exibe. |
| RNF04 | Segurança | A resposta correta nunca é enviada ao cliente antes do fim do tempo da pergunta. |
| RNF05 | Segurança | Todo texto digitado (nickname) é validado no servidor (tamanho e caracteres) e escapado na exibição. |
| RNF06 | Segurança | O código da sala é aleatório e não sequencial, com tamanho suficiente para dificultar tentativa e erro, e a busca por códigos tem rate limit. |
| RNF07 | Escala | Limites configuráveis para salas simultâneas e participantes por sala. Valores operacionais iniciais: 5 salas e 500 participantes por sala (incluindo o mestre), sujeitos a revalidação após teste de carga na infraestrutura de produção. |
| RNF08 | Escala | O estado serializável das salas é compartilhado via Redis, com coordenação das mutações e distribuição dos eventos Socket.IO entre instâncias. |
| RNF09 | Resiliência | Reconexão automática do cliente com identificador guardado no navegador; ao voltar, o jogador recebe o estado atual da partida. |
| RNF10 | Efemeridade | Salas e dados de jogo são descartados ao encerrar a partida ou após o tempo limite; nada é persistido no MVP. |
| RNF11 | Interface | Site responsivo, com prioridade para telas de celular, alvos de toque grandes e leitura sem rolagem durante a pergunta. |
| RNF12 | Compatibilidade | Funcionar nas versões atuais de Chrome, Safari, Firefox e Edge, em desktop e celular. |

## 8. Banco de perguntas

As perguntas ficam em um arquivo JSON mantido por você e carregado só pelo servidor; o arquivo nunca é servido ao cliente. Formato proposto:

```json
[
  {
    "id": "fil-0001",
    "categoria": "Filmes",
    "tipo": "multipla_escolha",
    "enunciado": "Texto da pergunta?",
    "alternativas": ["A", "B", "C", "D"],
    "correta": 2
  },
  {
    "id": "esp-0007",
    "categoria": "Esportes",
    "tipo": "verdadeiro_falso",
    "enunciado": "Afirmação a ser julgada.",
    "alternativas": ["Verdadeiro", "Falso"],
    "correta": 0
  }
]
```

O campo `correta` guarda o índice da alternativa certa e só existe no servidor.

**Regras de conteúdo**

- Cada pergunta tem um `id` único e uma única categoria; a lista de categorias é derivada do próprio arquivo.
- Múltipla escolha tem de 3 a 5 alternativas (padrão: 4); verdadeiro/falso tem sempre duas.
- O servidor valida o arquivo ao iniciar e recusa subir se houver id repetido, índice inválido ou categoria vazia.
- Para o sorteio sem repetição, cada categoria precisa ter perguntas suficientes para o maior número de perguntas que o mestre puder escolher. Ao misturar categorias, o servidor sorteia do conjunto reunido.
- Todo o conteúdo em português do Brasil. Categorias iniciais incluídas no banco: Animes, Esportes, Filmes, Geografia, Música e Séries.

Se o banco crescer ou passar a ser editado com frequência, a migração para um banco de dados é um passo natural, e o formato acima já mapeia para uma tabela.

## 9. Telas e estados

A partida passa por estados em sequência, com uma repetição entre pergunta e resposta.

&#91;embedded content: estados da partida · 7 estados, 1 repetição\]

O jogo repete pergunta e resposta até a última pergunta, quando segue para o ranking. Em qualquer etapa, o mestre ou o tempo limite podem levar a partida a Encerrada, de onde todos voltam à home.

| Tela | Quem vê | Conteúdo |
| --- | --- | --- |
| Home | Todos | Apresentação curta e botão para criar partida |
| Criação | Mestre | Categorias, número de perguntas, tempo por pergunta e nickname |
| Entrada por convite | Jogador | Campo de nickname, aviso de nickname em uso e mensagens de convite inválido ou de partida já iniciada |
| Lobby | Todos | Lista de participantes, contador e avisos de entrada; o botão de iniciar e o link de convite aparecem para o mestre |
| Contagem regressiva | Todos | Número em contagem até a primeira pergunta |
| Pergunta | Todos | Enunciado, alternativas, cronômetro e confirmação de resposta enviada |
| Resposta | Todos | Alternativa correta destacada e indicação de acerto ou erro do próprio jogador |
| Ranking final | Todos | Posições, pontos e destaque para o top 3 |
| Avisos | Todos | Convite inválido, sala encerrada, conexão perdida e vaga não recuperável |

## 10. Riscos

O maior risco técnico é o volume de mensagens em salas grandes; os demais são de abuso e de conteúdo.

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Salas grandes geram muitos eventos simultâneos (entradas no lobby, fim de pergunta) | Lentidão ou queda do servidor | Limite de 500 jogadores por sala, agrupar atualizações do lobby em lotes e testar carga antes de aumentar os limites |
| Jogador inspeciona a rede para descobrir a resposta | Ranking sem valor | Gabarito só no servidor e revelado após o fim do tempo (RNF04) |
| Reconexão depende do navegador: limpar dados, trocar de aparelho ou aba anônima perde a vaga | Frustração pontual | Aceito no MVP; informar na tela de erro que a vaga não pode ser recuperada |
| Latência diferente entre jogadores influencia o bônus de rapidez | Percepção de injustiça | Aceito no MVP; avaliar compensação depois |
| Sem moderação, nicknames ofensivos aparecem para todos, num produto de público geral | Dano à reputação | Filtro básico de palavras ou denúncia, se virar produto |
| Criação de salas em massa ou tentativa de adivinhar códigos | Consumo de recursos | Limite por IP, rate limit e códigos aleatórios (RF25, RNF06) |
| Salas abandonadas ocupam memória | Custo e instabilidade | Encerramento automático por tempo limite (RF23) |
| Banco pequeno repete perguntas entre partidas | Jogo previsível | Meta de volume por categoria antes do lançamento; esforço de curadoria é contínuo |

## 11. Decisões pendentes

Há dez pontos para fechar; a coluna da direita traz a proposta usada neste PRD enquanto não houver decisão.

| # | Decisão em aberto | Proposta atual |
| --- | --- | --- |
| 1 | Conta e login do mestre: foi mencionado como possível, o que conflita com "sem conta" no MVP | MVP sem conta; conta do mestre com dados persistidos como fase seguinte |
| 2 | Limites de salas e participantes | Configuráveis por `MAX_CONCURRENT_ROOMS` (padrão 5) e `MAX_PLAYERS_PER_ROOM` (padrão 500, incluindo o mestre); validar o perfil de 500 jogadores em uma sala antes de assumir capacidade de produção |
| 3 | Tempo limite do encerramento automático | A definir; sugestão de partida encerrada após inatividade prolongada e sala removida pouco depois do ranking |
| 4 | Faixas permitidas na criação: número de perguntas e tempo por pergunta | A definir; sugestão de 5 a 30 perguntas e de 10 a 60 segundos |
| 5 | O mestre que perde a conexão volta com o papel de mestre? | Sim, se voltar no mesmo navegador |
| 6 | Mestre encerra a partida no meio: mostra ranking parcial? | Sim, ranking com o que foi jogado até ali |
| 7 | Tamanho e caracteres válidos do nickname | De 2 a 20 caracteres, sem espaços nas pontas |
| 8 | Fórmula de pontuação | A da seção 6, a calibrar nos testes |
| 9 | Moderação mínima de nicknames para o público geral | Filtro local de palavrões e termos ofensivos comuns, com normalização básica para reduzir tentativas de contorno |
| 10 | Stack, hospedagem, nome do produto e domínio | Ainda não discutidos |

## 12. Roadmap sugerido

A ordem abaixo entrega uma partida jogável o quanto antes e deixa a escala para depois de validar o jogo.

1. **Fase 0, preparação:** fechar as decisões pendentes e montar um banco inicial com perguntas suficientes em duas ou três categorias.
2. **Fase 1, partida de ponta a ponta:** criar sala, convite, entrada por nickname, lobby, início com contagem regressiva, perguntas com cronômetro no servidor, pontuação e ranking com pódio.
3. **Fase 2, robustez:** reconexão, encerramento por tempo limite, redirecionamento à home, limite de salas por IP, rate limit e validações de entrada.
4. **Fase 3, escala:** estado de jogo no Redis, broadcast entre instâncias, recuperação de timers e teste reproduzível com 10 salas de 50 jogadores (500 conexões); meta de p95 inferior a 500 ms.
5. **Lançamento fechado:** testar com amigos e comunidades pequenas, ajustar a fórmula de pontuação e os tempos.
6. **Depois do MVP:** conta e login do mestre, histórico, sons e animações, moderação mais abrangente e as demais ideias fora do escopo, conforme a resposta do público.

**Baseline local da fase 3:** antes de configurar os novos limites, com Redis 7 e duas instâncias, o perfil de 500 conexões (10 salas de 50 jogadores) completou 2.500 entregas de pergunta e confirmou a rejeição da 11ª sala; p95 medido de 25 ms para o estado após entrada e 31 ms para entrega de pergunta. Não valida 500 jogadores em uma sala. Resultado de uma única máquina, a revalidar na infraestrutura de produção.
