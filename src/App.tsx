import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { randomAvatarId } from '../shared/avatars.ts';
import type { AvatarId } from '../shared/avatars.ts';
import { Alerts } from './components/Alerts.tsx';
import { AppHeader } from './components/AppHeader.tsx';
import { CountdownPage } from './components/CountdownPage.tsx';
import { EntryModal } from './components/EntryModal.tsx';
import { JoinPage } from './components/JoinPage.tsx';
import { LandingPage } from './components/LandingPage.tsx';
import { LobbyPage } from './components/LobbyPage.tsx';
import { MessagePage } from './components/MessagePage.tsx';
import { QuestionPage } from './components/QuestionPage.tsx';
import { RankingPage } from './components/RankingPage.tsx';
import { SetupPage } from './components/SetupPage.tsx';
import { PRESENTATION_STORAGE_KEY, readPresentationSettings } from './config/presentation.ts';
import { SoundEngine } from './lib/sound.ts';
import type { SoundKind } from './lib/sound.ts';
import { clearSavedSession, readSavedSession, saveSession, storeNotice, takeStoredNotice } from './services/session.ts';
import { emitWithAck, getRoomCodeFromUrl, socket } from './services/socket.ts';
import type {
  GameConfig,
  PlayerSummary,
  PresentationSettings,
  PresentationTheme,
  Question,
  RankingRow,
  RoomCreationRequest,
  RoomState,
  Stage
} from './types.ts';

const initialCode = getRoomCodeFromUrl();

export default function App() {
  const [stage, setStage] = useState<Stage>(initialCode ? 'recovering' : 'home');
  const [config, setConfig] = useState<GameConfig | null>(null);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState<AvatarId>(randomAvatarId);
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
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const [presentationSettings, setPresentationSettings] = useState<PresentationSettings>(readPresentationSettings);
  const soundEngineRef = useRef<SoundEngine | null>(null);
  const lastTickSecondRef = useRef(0);
  const recoveryInProgress = useRef(false);
  const queuePending = useRef(false);

  const isMaster = Boolean(room?.players.find((player) => player.id === playerId)?.isMaster);

  function playSound(kind: SoundKind) {
    soundEngineRef.current ??= new SoundEngine();
    soundEngineRef.current.play(kind, presentationSettings.soundEnabled);
  }

  useEffect(() => {
    window.localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(presentationSettings));
    document.body.dataset.theme = presentationSettings.theme;
    document.body.dataset.motion = presentationSettings.motionEnabled ? 'enabled' : 'reduced';
  }, [presentationSettings]);

  useEffect(() => {
    if (!isEntryModalOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsEntryModalOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isEntryModalOpen]);

  useEffect(() => {
    if (!isThemeMenuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsThemeMenuOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isThemeMenuOpen]);

  useEffect(() => {
    const message = takeStoredNotice();
    if (message) setNotice(message);
  }, []);

  useEffect(() => {
    void fetch('/api/config')
      .then(async (response) => {
        if (!response.ok) throw new Error('Não foi possível carregar as configurações do jogo.');
        return response.json() as Promise<GameConfig>;
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
        const response = await emitWithAck('room:rejoin', {
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
      storeNotice('A partida foi encerrada pelo mestre.');
      window.location.assign('/');
    };
    const onRoomExpired = ({ code, message }: { code: string; message: string }) => {
      clearSavedSession(code || initialCode);
      storeNotice(message);
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
      void emitWithAck('room:claim', { code, playerId: createdPlayerId, reconnectToken }).then((response) => {
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

  useEffect(() => {
    if (stage === 'reveal' && answerCorrect !== null) {
      playSound(answerCorrect ? 'correct' : 'wrong');
    }
  }, [stage, answerCorrect]);

  useEffect(() => {
    if (stage !== 'countdown' || countdown <= 0) return;
    playSound('countdown');
  }, [countdown, stage]);

  useEffect(() => {
    if (stage !== 'question') {
      lastTickSecondRef.current = 0;
      return;
    }
    if (remainingSeconds > 5 || remainingSeconds <= 0 || lastTickSecondRef.current === remainingSeconds) return;
    lastTickSecondRef.current = remainingSeconds;
    playSound('tick');
  }, [remainingSeconds, stage]);

  useEffect(() => {
    if (stage === 'ranking') {
      playSound('finish');
    }
  }, [stage]);

  useEffect(() => {
    if (stage !== 'question' || !question) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toUpperCase();
      const letterIndex = 'ABCD'.indexOf(key);
      const numberIndex = '1234'.indexOf(key);
      const index = letterIndex >= 0 ? letterIndex : numberIndex;
      if (index < 0 || index >= question.alternativas.length) return;
      event.preventDefault();
      void submitAnswer(index);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage, question, selected]);

  const selectedCount = useMemo(() => categories.reduce((sum, category) => sum + (config?.questionCounts[category] ?? 0), 0), [categories, config]);
  const totalQuestions = useMemo(() => Object.values(config?.questionCounts ?? {}).reduce((sum, count) => sum + count, 0), [config]);
  const maxAvailableQuestions = Math.min(config?.limits.maxQuestions ?? 30, selectedCount);
  const minimumQuestions = config?.limits.minQuestions ?? 5;
  const canCreateRoom = Boolean(config)
    && categories.length > 0
    && questionCount >= minimumQuestions
    && questionCount <= maxAvailableQuestions
    && nickname.trim().length >= 2
    && !isCreatingRoom;

  function toggleCategory(category: string) {
    playSound('pop');
    setCategories((current) => current.includes(category)
      ? current.filter((value) => value !== category)
      : [...current, category]);
  }

  function persistSession(code: string, id: string, token: string, playerNickname: string): void {
    saveSession(code, { playerId: id, reconnectToken: token, nickname: playerNickname });
  }

  async function createGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateRoom) return;
    setError('');
    setQueuePrompt(false);
    setIsCreatingRoom(true);
    const request = { categories, questionCount, timePerQuestionSeconds, nickname, avatar };
    try {
      const response = await emitWithAck('room:create', request);
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
      playSound('start');
      window.history.replaceState({}, '', `/?room=${response.code}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sala. Tente novamente.');
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function joinCreationQueue() {
    if (!pendingRoomRequest) return;
    setError('');
    queuePending.current = true;
    const response = await emitWithAck('room:queue:join', pendingRoomRequest);
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
    const response = await emitWithAck('room:queue:leave', {});
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

  async function joinGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const response = await emitWithAck('room:join', { code: initialCode, nickname, avatar });
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível entrar na sala.');
      return;
    }
    setPlayerId(response.playerId ?? '');
    if (response.playerId && response.reconnectToken) {
      persistSession(initialCode, response.playerId, response.reconnectToken, nickname);
    }
    playSound('notice');
  }

  async function startGame() {
    setError('');
    const response = await emitWithAck('room:start', {});
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível iniciar a partida.');
      return;
    }
    playSound('start');
  }

  async function endGame() {
    setError('');
    const response = await emitWithAck('room:end', {});
    if (!response.ok) setError(response.message ?? 'Não foi possível encerrar a partida.');
  }

  async function submitAnswer(index: number) {
    if (selected !== null) return;
    playSound('click');
    setSelected(index);
    const response = await emitWithAck('game:answer', index);
    if (!response.ok) {
      setSelected(null);
      setError(response.message ?? 'Não foi possível enviar a resposta.');
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      playSound('notice');
      setNotice('Link copiado para a área de transferência.');
      window.setTimeout(() => setNotice(''), 3000);
    } catch {
      setError('Não foi possível copiar automaticamente. Copie o link exibido.');
    }
  }

  function backHome() {
    window.location.href = '/';
  }

  function returnToLanding() {
    setError('');
    setQueuePrompt(false);
    setPendingRoomRequest(null);
    setStage('home');
  }

  function updatePresentationSettings(partial: Partial<PresentationSettings>) {
    setPresentationSettings((current) => ({ ...current, ...partial }));
  }

  function changeAvatar(nextAvatar: AvatarId) {
    setAvatar(nextAvatar);
    playSound('pop');
  }

  function handleSelectTheme(theme: PresentationTheme) {
    playSound('click');
    updatePresentationSettings({ theme });
    setIsThemeMenuOpen(false);
  }

  function handleToggleSound() {
    playSound('click');
    updatePresentationSettings({ soundEnabled: !presentationSettings.soundEnabled });
  }

  function handleToggleMotion() {
    playSound('click');
    updatePresentationSettings({ motionEnabled: !presentationSettings.motionEnabled });
  }

  function handleEntryContinue() {
    setIsEntryModalOpen(false);
    setError('');
    setStage('configuring');
  }

  function handleDismissQueue() {
    setQueuePrompt(false);
    setPendingRoomRequest(null);
    setError('');
  }

  return (
    <main className="page-shell">
      <AppHeader
        theme={presentationSettings.theme}
        soundEnabled={presentationSettings.soundEnabled}
        motionEnabled={presentationSettings.motionEnabled}
        isThemeMenuOpen={isThemeMenuOpen}
        onGoHome={backHome}
        onToggleThemeMenu={() => setIsThemeMenuOpen((open) => !open)}
        onSelectTheme={handleSelectTheme}
        onToggleSound={handleToggleSound}
        onToggleMotion={handleToggleMotion}
      />

      <section className="content">
        <Alerts error={error} notice={notice} />

        {stage === 'home' && (
          <LandingPage
            totalQuestions={totalQuestions}
            categoryCount={config?.categories.length ?? 0}
            maxPlayers={config?.limits.maxPlayersPerRoom ?? 500}
            onStart={() => setIsEntryModalOpen(true)}
          />
        )}

        {isEntryModalOpen && stage === 'home' && (
          <EntryModal onClose={() => setIsEntryModalOpen(false)} onContinue={handleEntryContinue} />
        )}

        {stage === 'configuring' && (
          <SetupPage
            config={config}
            nickname={nickname}
            onNicknameChange={setNickname}
            avatar={avatar}
            onAvatarChange={changeAvatar}
            categories={categories}
            onToggleCategory={toggleCategory}
            questionCount={questionCount}
            onQuestionCountChange={setQuestionCount}
            timePerQuestionSeconds={timePerQuestionSeconds}
            onTimePerQuestionChange={setTimePerQuestionSeconds}
            minimumQuestions={minimumQuestions}
            maxAvailableQuestions={maxAvailableQuestions}
            selectedCount={selectedCount}
            canCreateRoom={canCreateRoom}
            isCreatingRoom={isCreatingRoom}
            queuePrompt={queuePrompt}
            onBack={returnToLanding}
            onSubmit={createGame}
            onJoinQueue={() => void joinCreationQueue()}
            onDismissQueue={handleDismissQueue}
          />
        )}

        {stage === 'joining' && (
          <JoinPage
            nickname={nickname}
            avatar={avatar}
            onNicknameChange={setNickname}
            onAvatarChange={changeAvatar}
            onSubmit={joinGame}
          />
        )}

        {stage === 'recovering' && (
          <MessagePage
            icon="↻"
            eyebrow="RECONECTANDO"
            title="Recuperando sua partida"
            description={error || 'Estamos restaurando seu lugar e o estado atual do jogo.'}
          />
        )}

        {stage === 'queue' && (
          <MessagePage
            icon="↻"
            eyebrow="FILA DE CRIAÇÃO DE SALA"
            title="Você está na fila"
            description={`Sua posição: ${queuePosition ?? 'atualizando'} de ${queueTotal}. Sua sala será criada automaticamente quando houver uma vaga.`}
          >
            <button className="button button-secondary" onClick={() => void leaveCreationQueue()}>Sair da fila</button>
          </MessagePage>
        )}

        {stage === 'invalid' && (
          <MessagePage
            icon="✕"
            eyebrow="CONVITE INDISPONÍVEL"
            title="Não encontramos essa partida"
            description={error || 'O convite pode ter expirado ou a partida já começou.'}
          >
            <button className="button button-primary" onClick={backHome}>Voltar ao início</button>
          </MessagePage>
        )}

        {stage === 'lobby' && room && (
          <LobbyPage
            room={room}
            maxPlayers={config?.limits.maxPlayersPerRoom ?? 500}
            isMaster={isMaster}
            playerId={playerId}
            inviteLink={inviteLink}
            notice={notice}
            onCopyInvite={() => void copyInvite()}
            onStartGame={() => void startGame()}
          />
        )}

        {stage === 'countdown' && <CountdownPage countdown={countdown} />}

        {(stage === 'question' || stage === 'reveal') && question && (
          <QuestionPage
            question={question}
            stage={stage === 'reveal' ? 'reveal' : 'question'}
            selected={selected}
            correctIndex={correctIndex}
            answerCorrect={answerCorrect}
            remainingSeconds={remainingSeconds}
            playerCount={room?.playerCount ?? 1}
            onAnswer={(index) => void submitAnswer(index)}
          />
        )}

        {stage === 'ranking' && (
          <RankingPage
            ranking={ranking}
            playerId={playerId}
            isMaster={isMaster}
            room={room}
            onEndGame={() => void endGame()}
          />
        )}
      </section>
      <footer className="footer"><span>QUEM SABE MAIS</span><span>Feito para jogar junto</span></footer>
    </main>
  );
}
