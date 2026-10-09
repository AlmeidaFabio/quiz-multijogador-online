import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

type Stage = 'home' | 'recovering' | 'joining' | 'queue' | 'lobby' | 'countdown' | 'question' | 'reveal' | 'ranking' | 'invalid';
type PlayerSummary = { id: string; nickname: string; points: number; isMaster: boolean };
type Question = {
  id: string;
  categoria: string;
  tipo: 'multipla_escolha' | 'verdadeiro_falso';
  enunciado: string;
  alternativas: string[];
  number: number;
  total: number;
  endsAt: number;
};
type RoomState = {
  code: string;
  status: string;
  players: PlayerSummary[];
  playerCount: number;
  isMaster: boolean;
  questionCount: number;
  questionIndex: number;
  timePerQuestionSeconds: number;
  question: Question | null;
  countdownEndsAt: number | null;
  correctIndex: number | null;
  selectedAnswer: number | null;
  answerCorrect: boolean | null;
  ranking: RankingRow[] | null;
};
type RankingRow = PlayerSummary & { position: number; totalAnswerTimeMs: number };
type Config = {
  categories: string[];
  questionCounts: Record<string, number>;
  limits: {
    minQuestions: number;
    maxQuestions: number;
    minTimeSeconds: number;
    maxTimeSeconds: number;
    maxPlayersPerRoom: number;
  };
};
type Ack = {
  ok: boolean;
  message?: string;
  code?: string;
  errorCode?: string;
  playerId?: string;
  reconnectToken?: string;
  queued?: boolean;
  position?: number;
  total?: number;
};
type SavedSession = { playerId: string; reconnectToken: string; nickname: string };
type RoomCreationRequest = {
  categories: string[];
  questionCount: number;
  timePerQuestionSeconds: number;
  nickname: string;
};

const socket: Socket = io({ autoConnect: true });
const initialCode = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';

function sessionStorageKey(code: string): string {
  return `quiz-session:${code}`;
}

function readSavedSession(code: string): SavedSession | null {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(sessionStorageKey(code)) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const session = value as Partial<SavedSession>;
    return typeof session.playerId === 'string'
      && typeof session.reconnectToken === 'string'
      && typeof session.nickname === 'string'
      ? { playerId: session.playerId, reconnectToken: session.reconnectToken, nickname: session.nickname }
      : null;
  } catch {
    return null;
  }
}

function clearSavedSession(code: string): void {
  window.localStorage.removeItem(sessionStorageKey(code));
}

export default function App() {
  const [stage, setStage] = useState<Stage>(initialCode ? 'recovering' : 'home');
  const [config, setConfig] = useState<Config | null>(null);
  const [nickname, setNickname] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(5);
  const [timePerQuestionSeconds, setTimePerQuestionSeconds] = useState(20);
  const [room, setRoom] = useState<RoomState | null>(null);
  const [playerId, setPlayerId] = useState('');
  const [question, setQuestion] = useState<Question | null>(null);
  const [countdown, setCountdown] = useState(3);
  const [countdownEndsAt, setCountdownEndsAt] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const [answerCorrect, setAnswerCorrect] = useState<boolean | null>(null);
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [queuePrompt, setQueuePrompt] = useState(false);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueTotal, setQueueTotal] = useState(0);
  const [pendingRoomRequest, setPendingRoomRequest] = useState<RoomCreationRequest | null>(null);
  const recoveryInProgress = useRef(false);
  const queuePending = useRef(false);

  const isMaster = Boolean(room?.players.find((player) => player.id === playerId)?.isMaster);

  useEffect(() => {
    const message = window.sessionStorage.getItem('quiz-notice');
    if (message) {
      setNotice(message);
      window.sessionStorage.removeItem('quiz-notice');
    }
  }, []);

  useEffect(() => {
    void fetch('/api/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível carregar as configurações do jogo.');
        return response.json() as Promise<Config>;
      })
      .then((loaded) => {
        setConfig(loaded);
        setCategories(loaded.categories.slice(0, 1));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Falha ao carregar o jogo.'));
  }, []);

  useEffect(() => {
    if (!initialCode) return;
    const saved = readSavedSession(initialCode);
    if (saved) {
      setNickname(saved.nickname);
      const attemptRecovery = async () => {
        if (recoveryInProgress.current) return;
        recoveryInProgress.current = true;
        const response = await emitAck('room:rejoin', {
          code: initialCode,
          playerId: saved.playerId,
          reconnectToken: saved.reconnectToken
        });
        recoveryInProgress.current = false;
        if (response.ok) {
          setPlayerId(response.playerId ?? saved.playerId);
          persistSession(initialCode, response.playerId ?? saved.playerId, response.reconnectToken ?? saved.reconnectToken, saved.nickname);
          setError('');
          return;
        }
        setError(response.message ?? 'Não foi possível recuperar sua vaga.');
        if (response.message?.includes('encerrada')
            || response.message?.includes('vaga não pode ser recuperada')
            || response.message?.includes('dados de reconexão')) {
          const roomResponse = await fetch(`/api/rooms/${encodeURIComponent(initialCode)}`).catch(() => null);
          clearSavedSession(initialCode);
          if (roomResponse?.ok) {
            setError('Não foi possível recuperar esta vaga. Você pode entrar novamente com outro nickname.');
            setStage('joining');
          } else {
            setStage('invalid');
          }
          return;
        }
        setStage('recovering');
      };
      socket.on('connect', attemptRecovery);
      if (socket.connected) void attemptRecovery();
      return () => {
        socket.off('connect', attemptRecovery);
      };
    }
    void fetch(`/api/rooms/${encodeURIComponent(initialCode)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Este convite é inválido ou a partida já começou.');
        setStage('joining');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Não foi possível encontrar a sala.');
        setStage('invalid');
      });
  }, []);

  useEffect(() => {
    const onState = (next: RoomState) => {
      setRoom(next);
      setInviteLink(`${window.location.origin}/?room=${next.code}`);
      if (next.status === 'lobby') setStage('lobby');
      if (next.status === 'countdown') {
        if (next.countdownEndsAt) setCountdownEndsAt(next.countdownEndsAt);
        setStage('countdown');
      }
      if ((next.status === 'question' || next.status === 'reveal') && next.question) {
        setQuestion(next.question);
        setSelected(next.selectedAnswer);
        setCorrectIndex(next.correctIndex);
        setAnswerCorrect(next.answerCorrect);
        setStage(next.status);
      }
      if (next.status === 'finished' && next.ranking) {
        setRanking(next.ranking);
        setStage('ranking');
      }
    };
    const onRoster = (roster: { players: PlayerSummary[]; status: string; playerCount: number }) => {
      setRoom((current) => current ? { ...current, ...roster } : current);
    };
    const onCountdown = ({ seconds, startsAt }: { seconds: number; startsAt: number }) => {
      setCountdown(seconds);
      setCountdownEndsAt(startsAt);
      setStage('countdown');
    };
    const onQuestion = (next: Question) => {
      setQuestion(next);
      setSelected(null);
      setCorrectIndex(null);
      setAnswerCorrect(null);
      setStage('question');
    };
    const onReveal = (reveal: { correctIndex: number }) => {
      setCorrectIndex(reveal.correctIndex);
      setStage('reveal');
    };
    const onAnswerResult = (result: { correct: boolean }) => setAnswerCorrect(result.correct);
    const onRanking = (rows: RankingRow[]) => {
      setRanking(rows);
      setStage('ranking');
    };
    const onRoomEnded = ({ code }: { code: string }) => {
      clearSavedSession(code || initialCode);
      window.sessionStorage.setItem('quiz-notice', 'A partida foi encerrada pelo mestre.');
      window.location.assign('/');
    };
    const onRoomExpired = ({ code, message }: { code: string; message: string }) => {
      clearSavedSession(code || initialCode);
      window.sessionStorage.setItem('quiz-notice', message);
      window.location.assign('/');
    };
    const onNotice = (message: string) => {
      setNotice(message);
      window.setTimeout(() => setNotice(''), 3500);
    };
    const onQueuePosition = ({ position, total }: { position: number; total: number }) => {
      queuePending.current = true;
      setQueuePosition(position);
      setQueueTotal(total);
      setStage('queue');
    };
    const onQueueCreated = ({ code, playerId: createdPlayerId, reconnectToken, nickname: queuedNickname }: {
      code: string;
      playerId: string;
      reconnectToken: string;
      nickname: string;
    }) => {
      queuePending.current = false;
      setQueuePosition(null);
      setQueuePrompt(false);
      setError('');
      setPlayerId(createdPlayerId);
      persistSession(code, createdPlayerId, reconnectToken, queuedNickname);
      window.history.replaceState({}, '', `/?room=${code}`);
      void emitAck('room:claim', { code, playerId: createdPlayerId, reconnectToken }).then((response) => {
        if (!response.ok) {
          setError(response.message ?? 'A sala foi criada, mas não foi possível entrar nela.');
          setStage('home');
        }
      });
    };
    const onQueueError = ({ message }: { message: string }) => {
      queuePending.current = false;
      setQueuePosition(null);
      setQueueTotal(0);
      setQueuePrompt(false);
      setPendingRoomRequest(null);
      setError(message);
      setStage('home');
    };
    const onDisconnect = () => {
      if (!queuePending.current) return;
      queuePending.current = false;
      setQueuePosition(null);
      setQueueTotal(0);
      setQueuePrompt(false);
      setPendingRoomRequest(null);
      setError('Sua conexão caiu e você saiu da fila. Tente criar a sala novamente quando voltar.');
      setStage('home');
    };
    socket.on('room:state', onState);
    socket.on('room:roster', onRoster);
    socket.on('game:countdown', onCountdown);
    socket.on('game:question', onQuestion);
    socket.on('game:reveal', onReveal);
    socket.on('game:answer-result', onAnswerResult);
    socket.on('game:ranking', onRanking);
    socket.on('room:ended', onRoomEnded);
    socket.on('room:expired', onRoomExpired);
    socket.on('room:notice', onNotice);
    socket.on('room:queue:position', onQueuePosition);
    socket.on('room:queue:created', onQueueCreated);
    socket.on('room:queue:error', onQueueError);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('room:state', onState);
      socket.off('room:roster', onRoster);
      socket.off('game:countdown', onCountdown);
      socket.off('game:question', onQuestion);
      socket.off('game:reveal', onReveal);
      socket.off('game:answer-result', onAnswerResult);
      socket.off('game:ranking', onRanking);
      socket.off('room:ended', onRoomEnded);
      socket.off('room:expired', onRoomExpired);
      socket.off('room:notice', onNotice);
      socket.off('room:queue:position', onQueuePosition);
      socket.off('room:queue:created', onQueueCreated);
      socket.off('room:queue:error', onQueueError);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  useEffect(() => {
    if (stage !== 'countdown' || !countdownEndsAt) return;
    const update = () => setCountdown(Math.max(0, Math.ceil((countdownEndsAt - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [countdownEndsAt, stage]);

  useEffect(() => {
    if (stage !== 'question' || !question) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((question.endsAt - Date.now()) / 1000)));
    update();
    const interval = window.setInterval(update, 200);
    return () => window.clearInterval(interval);
  }, [question, stage]);

  const selectedCount = useMemo(() => categories.reduce((sum, category) => sum + (config?.questionCounts[category] ?? 0), 0), [categories, config]);
  const maxAvailableQuestions = Math.min(config?.limits.maxQuestions ?? 30, selectedCount);

  function toggleCategory(category: string) {
    setCategories((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : [...current, category]);
  }

  function emitAck(event: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve) => {
      socket.timeout(5000).emit(event, payload, (timeoutError: Error | null, response: Ack) => {
        if (timeoutError) {
          resolve({ ok: false, message: 'O servidor não respondeu. Tente novamente.' });
          return;
        }
        resolve(response);
      });
    });
  }

  function persistSession(code: string, id: string, token: string, playerNickname: string): void {
    window.localStorage.setItem(sessionStorageKey(code), JSON.stringify({
      playerId: id,
      reconnectToken: token,
      nickname: playerNickname
    } satisfies SavedSession));
  }

  async function createGame(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const request = { categories, questionCount, timePerQuestionSeconds, nickname };
    const response = await emitAck('room:create', request);
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível criar a sala.');
      if (response.errorCode === 'ROOMS_FULL') {
        setPendingRoomRequest(request);
        setQueuePrompt(true);
      }
      return;
    }
    setPlayerId(response.playerId ?? '');
    if (response.code && response.playerId && response.reconnectToken) {
      persistSession(response.code, response.playerId, response.reconnectToken, nickname);
    }
    window.history.replaceState({}, '', `/?room=${response.code}`);
  }

  async function joinCreationQueue() {
    if (!pendingRoomRequest) return;
    setError('');
    queuePending.current = true;
    const response = await emitAck('room:queue:join', pendingRoomRequest);
    if (!response.ok) {
      queuePending.current = false;
      setError(response.message ?? 'Não foi possível entrar na fila.');
      return;
    }
    if (!queuePending.current) return;
    setQueuePosition(response.position ?? 1);
    setQueueTotal(response.total ?? 1);
    setQueuePrompt(false);
    setStage('queue');
  }

  async function leaveCreationQueue() {
    const response = await emitAck('room:queue:leave', {});
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível sair da fila.');
      return;
    }
    queuePending.current = false;
    setQueuePosition(null);
    setQueueTotal(0);
    setPendingRoomRequest(null);
    setError('');
    setStage('home');
  }

  async function joinGame(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const response = await emitAck('room:join', { code: initialCode, nickname });
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível entrar na sala.');
      return;
    }
    setPlayerId(response.playerId ?? '');
    if (response.playerId && response.reconnectToken) {
      persistSession(initialCode, response.playerId, response.reconnectToken, nickname);
    }
  }

  async function startGame() {
    setError('');
    const response = await emitAck('room:start', {});
    if (!response.ok) setError(response.message ?? 'Não foi possível iniciar a partida.');
  }

  async function endGame() {
    setError('');
    const response = await emitAck('room:end', {});
    if (!response.ok) setError(response.message ?? 'Não foi possível encerrar a partida.');
  }

  async function submitAnswer(index: number) {
    if (selected !== null) return;
    setSelected(index);
    const response = await emitAck('game:answer', index);
    if (!response.ok) {
      setSelected(null);
      setError(response.message ?? 'Não foi possível enviar a resposta.');
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setNotice('Link copiado para a área de transferência.');
      window.setTimeout(() => setNotice(''), 3000);
    } catch {
      setError('Não foi possível copiar automaticamente. Copie o link exibido.');
    }
  }

  function backHome() {
    window.location.href = '/';
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <button className="brand" onClick={backHome} aria-label="Voltar à página inicial">
          <span className="brand-mark">Q</span>
          <span>quiz em grupo</span>
        </button>
        <span className="topbar-note">jogue junto, cada um no seu celular</span>
      </header>

      <section className="content">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {notice && <div className="alert alert-notice" role="status">{notice}</div>}

        {stage === 'home' && (
          <div className="home-layout">
            <div className="hero-copy">
              <p className="eyebrow">UMA PARTIDA, TODO MUNDO JUNTO</p>
              <h1>Quem sabe mais<br />e responde <em>mais rápido?</em></h1>
              <p className="hero-description">Crie uma sala, convide a turma e descubra quem leva o pódio. Sem cadastro, sem complicação.</p>
              <div className="feature-chips"><span>● Sem login</span><span>● Convite por link</span><span>● Feito para celular</span></div>
            </div>
            <form className="card setup-card" onSubmit={createGame}>
              <div className="card-heading">
                <div><p className="eyebrow">NOVA PARTIDA</p><h2>Prepare o desafio</h2></div>
                <span className="heading-icon">✦</span>
              </div>
              <label className="field-label">Seu nickname</label>
              <input required minLength={2} maxLength={20} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Ex.: Fabi" />
              <p className="form-hint">Nicknames com palavrões ou termos ofensivos não são permitidos.</p>
              <fieldset className="category-field">
                <legend className="field-label">Categorias</legend>
                <div className="category-list">
                  {config?.categories.map((category) => (
                    <label key={category} className={`category-option ${categories.includes(category) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={categories.includes(category)} onChange={() => toggleCategory(category)} />
                      <span>{category}</span><small>{config.questionCounts[category]} perguntas</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="form-row">
                <label><span className="field-label">Perguntas</span>
                  <input type="number" min={config?.limits.minQuestions ?? 5} max={maxAvailableQuestions} value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} />
                </label>
                <label><span className="field-label">Tempo por pergunta</span>
                  <select value={timePerQuestionSeconds} onChange={(event) => setTimePerQuestionSeconds(Number(event.target.value))}>
                    {[10, 15, 20, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} segundos</option>)}
                  </select>
                </label>
              </div>
              <button className="button button-primary button-wide" type="submit" disabled={!config || categories.length === 0}>Criar sala e jogar <span>→</span></button>
              {queuePrompt && <div className="alert alert-notice" role="status">
                <p>O limite de salas foi atingido. Quer entrar na fila? Sua sala será criada automaticamente quando houver uma vaga.</p>
                <div className="form-row">
                  <button className="button button-primary" type="button" onClick={() => void joinCreationQueue()}>Entrar na fila</button>
                  <button className="button button-secondary" type="button" onClick={() => {
                    setQueuePrompt(false);
                    setPendingRoomRequest(null);
                    setError('');
                  }}>Agora não</button>
                </div>
              </div>}
              <p className="form-hint">Até {config?.limits.maxPlayersPerRoom ?? 500} jogadores por sala.</p>
              <p className="form-hint">Você também participa da partida.</p>
            </form>
          </div>
        )}

        {stage === 'joining' && (
          <div className="center-panel">
            <div className="card join-card">
              <p className="eyebrow">VOCÊ FOI CONVIDADO</p>
              <h1>Entre na partida</h1>
              <p className="muted">Escolha como a turma vai chamar você.</p>
              <form onSubmit={joinGame}>
                <label className="field-label" htmlFor="join-nickname">Seu nickname</label>
                <input id="join-nickname" autoFocus required minLength={2} maxLength={20} value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="Ex.: Fabi" />
                <p className="form-hint">Nicknames com palavrões ou termos ofensivos não são permitidos.</p>
                <button className="button button-primary button-wide" type="submit">Entrar na sala <span>→</span></button>
              </form>
            </div>
          </div>
        )}

        {stage === 'recovering' && (
          <div className="center-panel"><div className="card message-card">
            <span className="large-icon">↻</span><p className="eyebrow">RECONECTANDO</p>
            <h1>Recuperando sua partida</h1><p className="muted">{error || 'Estamos restaurando seu lugar e o estado atual do jogo.'}</p>
          </div></div>
        )}

        {stage === 'queue' && (
          <div className="center-panel"><div className="card message-card">
            <span className="large-icon">↻</span><p className="eyebrow">FILA DE CRIAÇÃO DE SALA</p>
            <h1>Você está na fila</h1>
            <p className="muted">Sua posição: {queuePosition ?? 'atualizando'} de {queueTotal}. Sua sala será criada automaticamente quando houver uma vaga.</p>
            <button className="button button-secondary" onClick={() => void leaveCreationQueue()}>Sair da fila</button>
          </div></div>
        )}

        {stage === 'invalid' && (
          <div className="center-panel"><div className="card message-card">
            <span className="large-icon">✕</span><p className="eyebrow">CONVITE INDISPONÍVEL</p>
            <h1>Não encontramos essa partida</h1><p className="muted">{error || 'O convite pode ter expirado ou a partida já começou.'}</p>
            <button className="button button-primary" onClick={backHome}>Voltar ao início</button>
          </div></div>
        )}

        {stage === 'lobby' && room && (
          <div className="center-panel">
            <div className="card lobby-card">
              <div className="lobby-top">
                <div><p className="eyebrow">SALA {room.code}</p><h1>Chame a sua turma</h1><p className="muted">A partida começa quando o mestre der o sinal.</p></div>
                <div className="player-count"><strong>{room.playerCount}/{config?.limits.maxPlayersPerRoom ?? 500}</strong><span>{room.playerCount === 1 ? 'jogador' : 'jogadores'}</span></div>
              </div>
              <div className="invite-box">
                <div><span className="field-label">LINK DE CONVITE</span><a href={inviteLink}>{inviteLink}</a></div>
                <button className="button button-secondary" onClick={() => void copyInvite()}>Copiar link</button>
              </div>
              {notice && <p className="lobby-notice">{notice}</p>}
              <div className="roster-heading"><h2>Na sala</h2><span>{room.playerCount} participante{room.playerCount === 1 ? '' : 's'}</span></div>
              <ul className="player-list">
                {room.players.map((player, index) => <li key={player.id}>
                  <span className="avatar">{player.nickname.slice(0, 1).toUpperCase()}</span>
                  <span className="player-name">{player.nickname}{player.id === playerId && <small>Você</small>}</span>
                  {player.isMaster && <span className="master-badge">MESTRE</span>}
                  <span className="player-index">{String(index + 1).padStart(2, '0')}</span>
                </li>)}
              </ul>
              {isMaster ? <button className="button button-primary button-wide" onClick={() => void startGame()}>Começar partida <span>→</span></button> : <div className="waiting-note"><span className="pulse-dot" /> Aguardando o mestre iniciar...</div>}
              <p className="form-hint">{room.questionCount} perguntas · {room.timePerQuestionSeconds} segundos cada</p>
            </div>
          </div>
        )}

        {stage === 'countdown' && (
          <div className="center-panel"><div className="countdown-stage"><p className="eyebrow">PREPARE-SE</p><h1>A partida começa em</h1><div className="countdown-number">{countdown}</div><p className="muted">Boa sorte para todo mundo!</p></div></div>
        )}

        {(stage === 'question' || stage === 'reveal') && question && (
          <div className="center-panel"><div className="card question-card">
            <div className="question-meta">
              <span className="eyebrow">{question.categoria.toUpperCase()} <i>·</i> PERGUNTA {question.number} DE {question.total}</span>
              <span className={`timer ${remainingSeconds <= 5 ? 'timer-urgent' : ''}`} aria-label={`${remainingSeconds} segundos`}>{stage === 'reveal' ? '✓' : remainingSeconds}</span>
            </div>
            <div className="progress-track"><span style={{ width: `${((question.number - 1) / question.total) * 100}%` }} /></div>
            <h1>{question.enunciado}</h1>
            <div className="answer-grid">
              {question.alternativas.map((alternative, index) => {
                const isCorrect = correctIndex === index;
                const isWrongSelection = selected === index && correctIndex !== null && !isCorrect;
                return <button
                  key={`${question.id}-${index}`}
                  className={`answer-option ${selected === index ? 'answer-selected' : ''} ${isCorrect ? 'answer-correct' : ''} ${isWrongSelection ? 'answer-wrong' : ''}`}
                  disabled={stage === 'reveal' || selected !== null || remainingSeconds <= 0}
                  onClick={() => void submitAnswer(index)}
                >
                  <span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{alternative}</span>
                  {isCorrect && <span className="answer-mark">✓</span>}
                </button>;
              })}
            </div>
            <div className="question-foot">
              {stage === 'reveal'
                ? <strong className={answerCorrect ? 'result-correct' : 'result-wrong'}>{answerCorrect === null ? `Resposta: ${question.alternativas[correctIndex ?? 0]}` : answerCorrect ? 'Você acertou!' : `A resposta era: ${question.alternativas[correctIndex ?? 0]}`}</strong>
                : <span>{selected === null ? 'Toque em uma alternativa para responder' : 'Resposta enviada! Aguarde o tempo terminar.'}</span>}
              <span>{room?.playerCount ?? 1} jogando</span>
            </div>
          </div></div>
        )}

        {stage === 'ranking' && (
          <div className="center-panel"><div className="card ranking-card">
            <div className="ranking-heading"><span className="trophy">✦</span><p className="eyebrow">FIM DE JOGO</p><h1>Esse é o pódio!</h1><p className="muted">A rapidez fez a diferença.</p></div>
            <div className="podium">
              {[ranking[1], ranking[0], ranking[2]].map((player) => player && <div className={`podium-player podium-${player.position}`} key={player.id}>
                <span className="podium-avatar">{player.nickname.slice(0, 1).toUpperCase()}</span><strong>{player.nickname}</strong><span>{player.points} pts</span><b>{player.position}</b>
              </div>)}
            </div>
            <ol className="ranking-list">
              {ranking.map((player) => <li key={player.id}><span className="rank-position">{player.position}</span><span className="player-name">{player.nickname}{player.id === playerId && <small>Você</small>}</span><span className="rank-time">{(player.totalAnswerTimeMs / 1000).toFixed(1)} s</span><strong>{player.points} pts</strong></li>)}
            </ol>
            {isMaster
              ? <button className="button button-primary button-wide" onClick={() => void endGame()}>Encerrar partida e voltar ao início <span>→</span></button>
              : <p className="form-hint">Aguardando o mestre encerrar a partida.</p>}
          </div></div>
        )}
      </section>
      <footer className="footer"><span>QUIZ EM GRUPO</span><span>Feito para jogar junto</span></footer>
    </main>
  );
}
