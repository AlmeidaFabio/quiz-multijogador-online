import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { io, type Socket } from 'socket.io-client';
import { AVATARS, avatarById, avatarColors, randomAvatarId } from '../shared/avatars.ts';
import type { AvatarId } from '../shared/avatars.ts';

type Stage = 'home' | 'configuring' | 'recovering' | 'joining' | 'queue' | 'lobby' | 'countdown' | 'question' | 'reveal' | 'ranking' | 'invalid';
type PlayerSummary = { id: string; nickname: string; avatar: string; points: number; isMaster: boolean };
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
type PresentationTheme = 'classic' | 'midnight' | 'neon';
type PresentationSettings = {
  theme: PresentationTheme;
  soundEnabled: boolean;
  motionEnabled: boolean;
};
type RoomCreationRequest = {
  categories: string[];
  questionCount: number;
  timePerQuestionSeconds: number;
  nickname: string;
  avatar: AvatarId;
};

const socket: Socket = io({ autoConnect: true });
const initialCode = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';

const defaultPresentationSettings: PresentationSettings = {
  theme: 'neon',
  soundEnabled: true,
  motionEnabled: true
};

const CATEGORY_ICONS: Record<string, string> = {
  Animes: '🎌',
  Games: '🎮',
  Filmes: '🎬',
  'Séries': '📺',
  Esportes: '🏆',
  Geografia: '🌍',
  'História': '🏛️',
  'Ciências': '🔬',
  'Música': '🎵',
  'Super Nerd': '🤓'
};

function categoryIcon(category: string): string {
  return CATEGORY_ICONS[category] ?? '🎯';
}

function ThemeIcon({ theme }: { theme: PresentationTheme }) {
  if (theme === 'classic') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="currentColor" />
        <path
          d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (theme === 'midnight') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        <path d="M20.5 13.2A8.6 8.6 0 1 1 10.8 3.5a6.9 6.9 0 0 0 9.7 9.7Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2.6l1.9 5.9 5.9 1.9-5.9 1.9L12 18.2l-1.9-5.9-5.9-1.9 5.9-1.9L12 2.6Z" />
      <path d="M18.6 15.4l.9 2.7 2.7.9-2.7.9-.9 2.7-.9-2.7-2.7-.9 2.7-.9.9-2.7Z" opacity=".65" />
    </svg>
  );
}

function SoundIcon({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4Z" />
      <path d="M16 8.8a4.6 4.6 0 0 1 0 6.4M18.6 6.4a8 8 0 0 1 0 11.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.2L12 5.6v12.8L7.2 14.5H4Z" />
      <path d="M16.2 9.8l4.6 4.6M20.8 9.8l-4.6 4.6" />
    </svg>
  );
}

function MotionIcon({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M13.4 2 4.8 13.2h5.3L9.8 22l8.8-11.2h-5.4L13.4 2Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6.5" y="5" width="4" height="14" rx="1.4" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.4" />
    </svg>
  );
}

const THEME_OPTIONS: Array<{ value: PresentationTheme; label: string }> = [
  { value: 'classic', label: 'Tema claro' },
  { value: 'midnight', label: 'Tema noite' },
  { value: 'neon', label: 'Tema neon' }
];

function avatarStyle(avatar: string | undefined): CSSProperties {
  const [from, to] = avatarColors(avatar);
  return { '--avatar-a': from, '--avatar-b': to } as CSSProperties;
}

function PlayerAvatar({ avatar, size = 'sm' }: { avatar?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`avatar avatar-${size}`} style={avatarStyle(avatar)} aria-hidden="true">
      {avatarById(avatar).emoji}
    </span>
  );
}

function AvatarPicker({ value, onChange, labelId }: { value: AvatarId; onChange: (avatar: AvatarId) => void; labelId: string }) {
  return (
    <div className="avatar-picker" role="radiogroup" aria-labelledby={labelId}>
      {AVATARS.map((option) => (
        <button
          key={option.id}
          type="button"
          role="radio"
          aria-checked={value === option.id}
          aria-label={option.label}
          title={option.label}
          className={`avatar-choice ${value === option.id ? 'is-selected' : ''}`}
          style={avatarStyle(option.id)}
          onClick={() => onChange(option.id)}
        >
          <span aria-hidden="true">{option.emoji}</span>
        </button>
      ))}
    </div>
  );
}

type SoundKind = 'click' | 'pop' | 'correct' | 'wrong' | 'notice' | 'countdown' | 'tick' | 'start' | 'finish';
type SoundNote = {
  frequency: number;
  duration: number;
  delay?: number;
  type?: OscillatorType;
  volume?: number;
  slideTo?: number;
};

const SOUND_NOTES: Record<SoundKind, SoundNote[]> = {
  click: [{ frequency: 640, duration: 0.06, type: 'triangle', volume: 0.03 }],
  pop: [{ frequency: 420, duration: 0.09, type: 'sine', volume: 0.035, slideTo: 760 }],
  correct: [
    { frequency: 660, duration: 0.12, type: 'triangle', volume: 0.04 },
    { frequency: 880, duration: 0.14, delay: 0.1, type: 'triangle', volume: 0.035 },
    { frequency: 1320, duration: 0.18, delay: 0.2, type: 'sine', volume: 0.025 }
  ],
  wrong: [
    { frequency: 240, duration: 0.16, type: 'sawtooth', volume: 0.03, slideTo: 150 },
    { frequency: 170, duration: 0.18, delay: 0.12, type: 'sawtooth', volume: 0.025, slideTo: 110 }
  ],
  notice: [{ frequency: 540, duration: 0.09, type: 'sine', volume: 0.03 }],
  countdown: [{ frequency: 440, duration: 0.08, type: 'square', volume: 0.022 }],
  tick: [{ frequency: 920, duration: 0.05, type: 'square', volume: 0.022 }],
  start: [
    { frequency: 392, duration: 0.1, type: 'sine', volume: 0.035 },
    { frequency: 523.25, duration: 0.1, delay: 0.09, type: 'sine', volume: 0.035 },
    { frequency: 659.25, duration: 0.12, delay: 0.18, type: 'sine', volume: 0.035 },
    { frequency: 1046.5, duration: 0.22, delay: 0.3, type: 'sine', volume: 0.03 }
  ],
  finish: [
    { frequency: 523.25, duration: 0.14, type: 'triangle', volume: 0.04 },
    { frequency: 659.25, duration: 0.14, delay: 0.12, type: 'triangle', volume: 0.04 },
    { frequency: 783.99, duration: 0.16, delay: 0.24, type: 'triangle', volume: 0.04 },
    { frequency: 1046.5, duration: 0.34, delay: 0.38, type: 'triangle', volume: 0.035 }
  ]
};

const CONFETTI_PIECES = Array.from({ length: 16 }, (_, index) => ({
  left: `${(index * 61) % 96 + 2}%`,
  delay: `${(index % 8) * 0.35}s`,
  duration: `${3.4 + (index % 5) * 0.7}s`,
  rotate: `${(index * 47) % 360}deg`,
  color: ['#ffd166', 'var(--accent)', 'var(--accent-2)', 'var(--accent-3)'][index % 4]
}));

function isPresentationTheme(value: unknown): value is PresentationTheme {
  return value === 'classic' || value === 'midnight' || value === 'neon';
}

function readPresentationSettings(): PresentationSettings {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem('quiz-presentation-settings') ?? 'null');
    if (typeof value !== 'object' || value === null) return defaultPresentationSettings;
    const settings = value as Partial<PresentationSettings>;
    return {
      theme: isPresentationTheme(settings.theme) ? settings.theme : defaultPresentationSettings.theme,
      soundEnabled: settings.soundEnabled !== false,
      motionEnabled: settings.motionEnabled !== false
    };
  } catch {
    return defaultPresentationSettings;
  }
}

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
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastTickSecondRef = useRef(0);
  const recoveryInProgress = useRef(false);
  const queuePending = useRef(false);

  const isMaster = Boolean(room?.players.find((player) => player.id === playerId)?.isMaster);

  function playPresentationEffect(kind: SoundKind) {
    if (!presentationSettings.soundEnabled) return;
    const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor || typeof AudioCtor !== 'function') return;
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtor();
    }
    const context = audioContextRef.current;
    if (context.state === 'suspended') void context.resume();

    const startAt = context.currentTime + 0.01;
    for (const note of SOUND_NOTES[kind]) {
      const oscillator = context.createOscillator();
      const gainNode = context.createGain();
      const noteStart = startAt + (note.delay ?? 0);
      const noteEnd = noteStart + note.duration;
      oscillator.type = note.type ?? 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, noteStart);
      if (note.slideTo) {
        oscillator.frequency.exponentialRampToValueAtTime(note.slideTo, noteEnd);
      }
      gainNode.gain.setValueAtTime(0.0001, noteStart);
      gainNode.gain.exponentialRampToValueAtTime(note.volume ?? 0.03, noteStart + 0.012);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
      oscillator.connect(gainNode);
      gainNode.connect(context.destination);
      oscillator.start(noteStart);
      oscillator.stop(noteEnd + 0.02);
    }
  }

  useEffect(() => {
    window.localStorage.setItem('quiz-presentation-settings', JSON.stringify(presentationSettings));
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

  useEffect(() => {
    if (stage === 'reveal' && answerCorrect !== null) {
      playPresentationEffect(answerCorrect ? 'correct' : 'wrong');
    }
  }, [stage, answerCorrect]);

  useEffect(() => {
    if (stage !== 'countdown' || countdown <= 0) return;
    playPresentationEffect('countdown');
  }, [countdown, stage]);

  useEffect(() => {
    if (stage !== 'question') {
      lastTickSecondRef.current = 0;
      return;
    }
    if (remainingSeconds > 5 || remainingSeconds <= 0 || lastTickSecondRef.current === remainingSeconds) return;
    lastTickSecondRef.current = remainingSeconds;
    playPresentationEffect('tick');
  }, [remainingSeconds, stage]);

  useEffect(() => {
    if (stage === 'ranking') {
      playPresentationEffect('finish');
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
  const rankingMaxPoints = Math.max(1, ...ranking.map((player) => player.points));
  const myRankingRow = ranking.find((player) => player.id === playerId);
  const maxAvailableQuestions = Math.min(config?.limits.maxQuestions ?? 30, selectedCount);
  const minimumQuestions = config?.limits.minQuestions ?? 5;
  const canCreateRoom = Boolean(config)
    && categories.length > 0
    && questionCount >= minimumQuestions
    && questionCount <= maxAvailableQuestions
    && nickname.trim().length >= 2
    && !isCreatingRoom;

  function toggleCategory(category: string) {
    playPresentationEffect('pop');
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
    if (!canCreateRoom) return;
    setError('');
    setQueuePrompt(false);
    setIsCreatingRoom(true);
    const request = { categories, questionCount, timePerQuestionSeconds, nickname, avatar };
    try {
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
      playPresentationEffect('start');
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
    const response = await emitAck('room:join', { code: initialCode, nickname, avatar });
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível entrar na sala.');
      return;
    }
    setPlayerId(response.playerId ?? '');
    if (response.playerId && response.reconnectToken) {
      persistSession(initialCode, response.playerId, response.reconnectToken, nickname);
    }
    playPresentationEffect('notice');
  }

  async function startGame() {
    setError('');
    const response = await emitAck('room:start', {});
    if (!response.ok) {
      setError(response.message ?? 'Não foi possível iniciar a partida.');
      return;
    }
    playPresentationEffect('start');
  }

  async function endGame() {
    setError('');
    const response = await emitAck('room:end', {});
    if (!response.ok) setError(response.message ?? 'Não foi possível encerrar a partida.');
  }

  async function submitAnswer(index: number) {
    if (selected !== null) return;
    playPresentationEffect('click');
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
      playPresentationEffect('notice');
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
    playPresentationEffect('pop');
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <button className="brand" onClick={backHome} aria-label="Voltar à página inicial">
          <span className="brand-mark">Q</span>
          <span>Quem Sabe Mais</span>
        </button>
        <div className="topbar-actions">
          <div className="presentation-controls" aria-label="Tema da interface">
            <button
              type="button"
              className="theme-mobile-toggle"
              aria-expanded={isThemeMenuOpen}
              aria-haspopup="true"
              aria-controls="theme-options"
              aria-label="Escolher tema"
              onClick={() => setIsThemeMenuOpen((open) => !open)}
            >
              <ThemeIcon theme={presentationSettings.theme} />
              <span className="theme-caret" aria-hidden="true">▾</span>
            </button>
            <div id="theme-options" className={`theme-switcher ${isThemeMenuOpen ? 'theme-switcher-open' : ''}`}>
              {THEME_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`theme-option ${presentationSettings.theme === value ? 'is-active' : ''}`}
                  onClick={() => {
                    playPresentationEffect('click');
                    updatePresentationSettings({ theme: value });
                    setIsThemeMenuOpen(false);
                  }}
                  aria-label={label}
                  title={label}
                  aria-pressed={presentationSettings.theme === value}
                >
                  <ThemeIcon theme={value} />
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="settings-toggle"
            aria-pressed={presentationSettings.soundEnabled}
            aria-label={presentationSettings.soundEnabled ? 'Desativar sons' : 'Ativar sons'}
            title={presentationSettings.soundEnabled ? 'Desativar sons' : 'Ativar sons'}
            onClick={() => {
              playPresentationEffect('click');
              updatePresentationSettings({ soundEnabled: !presentationSettings.soundEnabled });
            }}
          >
            <SoundIcon enabled={presentationSettings.soundEnabled} /><span>Sons</span>
          </button>
          <button
            type="button"
            className="settings-toggle"
            aria-pressed={presentationSettings.motionEnabled}
            aria-label={presentationSettings.motionEnabled ? 'Reduzir animações' : 'Ativar animações'}
            title={presentationSettings.motionEnabled ? 'Reduzir animações' : 'Ativar animações'}
            onClick={() => {
              playPresentationEffect('click');
              updatePresentationSettings({ motionEnabled: !presentationSettings.motionEnabled });
            }}
          >
            <MotionIcon enabled={presentationSettings.motionEnabled} /><span>Animações</span>
          </button>
        </div>
      </header>

      <section className="content">
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {notice && <div className="alert alert-notice" role="status">{notice}</div>}

        {stage === 'home' && (
          <div className="landing-layout">
            <div className="hero-copy">
              <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> QUIZ AO VIVO · MULTIJOGADOR</p>
              <h1>Quem sabe mais<br />e responde <em>mais rápido?</em></h1>
              <p className="hero-description">Crie uma sala, convide a turma e descubra quem leva o pódio. Sem cadastro, direto no navegador.</p>
              <div className="hero-actions">
                <button className="button button-primary landing-cta" type="button" onClick={() => setIsEntryModalOpen(true)}>
                  Criar sala e jogar <span className="cta-arrow" aria-hidden="true">→</span>
                </button>
                <span className="hero-note">Grátis · sem instalar nada</span>
              </div>
              <div className="hero-stats">
                <span className="hero-stat"><strong>{totalQuestions || '—'}</strong><small>perguntas</small></span>
                <span className="hero-stat"><strong>{config?.categories.length ?? '—'}</strong><small>categorias</small></span>
                <span className="hero-stat"><strong>{config?.limits.maxPlayersPerRoom ?? 500}</strong><small>jogadores por sala</small></span>
              </div>
            </div>
            <div className="landing-preview" aria-hidden="true">
              <div className="preview-glow" />
              <div className="preview-orbit preview-orbit-one" />
              <div className="preview-orbit preview-orbit-two" />
              <div className="preview-card">
                <div className="preview-head">
                  <span className="preview-badge">🎮 GAMES</span>
                  <span className="preview-timer">12</span>
                </div>
                <p className="preview-question">Qual empresa criou o Mario?</p>
                <div className="preview-answers">
                  <span>Sega</span>
                  <span className="is-right">Nintendo <b>✓</b></span>
                </div>
                <div className="preview-progress"><i /></div>
                <div className="preview-players">
                  <PlayerAvatar avatar="fox" size="xs" /><PlayerAvatar avatar="panda" size="xs" /><PlayerAvatar avatar="frog" size="xs" />
                  <small>+12 na sala</small>
                </div>
              </div>
              <span className="preview-float preview-float-top">⚡</span>
              <span className="preview-float preview-float-bottom">+250</span>
            </div>
          </div>
        )}

        {isEntryModalOpen && stage === 'home' && (
          <div className="modal-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setIsEntryModalOpen(false);
          }}>
            <section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-modal-title" aria-describedby="entry-modal-description">
              <button className="modal-close" type="button" aria-label="Fechar" autoFocus onClick={() => setIsEntryModalOpen(false)}>×</button>
              <span className="modal-icon" aria-hidden="true">Q</span>
              <p className="eyebrow">VAMOS COMEÇAR</p>
              <h2 id="entry-modal-title">Como quer continuar?</h2>
              <p className="modal-description" id="entry-modal-description">Crie sua sala sem cadastro ou use sua conta para uma experiência personalizada.</p>
              <button className="button button-google" type="button" disabled aria-describedby="google-coming-soon">
                <span className="google-mark" aria-hidden="true">G</span>
                Continuar com Google
                <span className="coming-soon-badge">Em breve</span>
              </button>
              <p className="google-coming-soon" id="google-coming-soon">O acesso com Google será disponibilizado em breve.</p>
              <div className="modal-divider"><span>ou</span></div>
              <button className="button button-primary button-wide modal-continue" type="button" onClick={() => {
                setIsEntryModalOpen(false);
                setError('');
                setStage('configuring');
              }}>
                Continuar sem login <span aria-hidden="true">→</span>
              </button>
              <p className="modal-footnote">Sem conta, senha ou cadastro.</p>
            </section>
          </div>
        )}

        {stage === 'configuring' && (
          <div className="config-page">
            <div className="config-page-heading">
              <button className="back-link" type="button" onClick={returnToLanding}><span aria-hidden="true">←</span> Voltar</button>
              <div className="config-step" aria-label="Etapa 2 de 2">
                <span className="config-step-done">1</span><i /><span className="config-step-current">2</span>
              </div>
              <p className="eyebrow">ETAPA 2 DE 2</p>
              <h1>Configure sua sala</h1>
              <p className="config-intro">Escolha as categorias, o ritmo e prepare a partida para sua turma.</p>
            </div>
            <form className="card setup-card" onSubmit={createGame}>
              <div className="card-heading">
                <div>
                  <p className="eyebrow">NOVA PARTIDA</p>
                  <h2>Monte seu quiz</h2>
                  <p className="setup-subtitle">Leva menos de um minuto para preparar.</p>
                </div>
                <span className="heading-icon" aria-hidden="true">✦</span>
              </div>
              <div className="setup-field">
                <label className="field-label" htmlFor="host-nickname">Como vamos chamar você?</label>
                <input
                  id="host-nickname"
                  required
                  minLength={2}
                  maxLength={20}
                  autoComplete="nickname"
                  value={nickname}
                  onChange={(event) => setNickname(event.target.value)}
                  placeholder="Ex.: Fabi"
                  disabled={isCreatingRoom}
                />
                <p className="field-help">De 2 a 20 caracteres. Você também participa da partida.</p>
              </div>
              <div className="setup-field">
                <span className="field-label" id="setup-avatar-label">Escolha seu avatar</span>
                <AvatarPicker value={avatar} onChange={changeAvatar} labelId="setup-avatar-label" />
                <p className="field-help">Ele aparece no lobby, no pódio e no ranking.</p>
              </div>
              <fieldset className="category-field" disabled={isCreatingRoom} aria-describedby="category-help">
                <legend className="field-label">
                  Escolha as categorias
                  <span className="selection-count">{categories.length} selecionada{categories.length === 1 ? '' : 's'}</span>
                </legend>
                <p className="field-help" id="category-help">Pode combinar quantas quiser.</p>
                <div className="category-list">
                  {config?.categories.map((category) => (
                    <label key={category} className={`category-option ${categories.includes(category) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={categories.includes(category)} onChange={() => toggleCategory(category)} />
                      <span className="category-emoji" aria-hidden="true">{categoryIcon(category)}</span>
                      <span className="category-name">{category}</span>
                    </label>
                  )) ?? <p className="category-loading" role="status">Carregando categorias...</p>}
                </div>
              </fieldset>
              <div className="form-row setup-options">
                <label><span className="field-label">Perguntas</span>
                  <input
                    type="number"
                    min={minimumQuestions}
                    max={maxAvailableQuestions}
                    value={questionCount}
                    onChange={(event) => setQuestionCount(event.target.value === '' ? 0 : Number(event.target.value))}
                    aria-describedby="question-count-help"
                    disabled={isCreatingRoom}
                  />
                  <small className="field-help" id="question-count-help">De {minimumQuestions} a {Math.max(minimumQuestions, maxAvailableQuestions)}</small>
                </label>
                <label><span className="field-label">Tempo por pergunta</span>
                  <select value={timePerQuestionSeconds} onChange={(event) => setTimePerQuestionSeconds(Number(event.target.value))} disabled={isCreatingRoom}>
                    {[10, 15, 20, 30, 45, 60].map((seconds) => <option key={seconds} value={seconds}>{seconds} segundos</option>)}
                  </select>
                </label>
              </div>
              <div className="setup-summary" aria-live="polite">
                <span className="summary-icon" aria-hidden="true">✦</span>
                <span>
                  <strong>{questionCount || '—'} perguntas · {timePerQuestionSeconds}s cada</strong>
                  <small>{categories.length ? `${categories.length} categoria${categories.length === 1 ? '' : 's'} na partida` : 'Nenhuma categoria selecionada'}</small>
                </span>
              </div>
              {selectedCount > 0 && questionCount > selectedCount && (
                <p className="inline-validation" role="alert">Reduza o número de perguntas ou escolha mais categorias.</p>
              )}
              <button className="button button-primary button-wide create-room-button" type="submit" disabled={!canCreateRoom}>
                {isCreatingRoom
                  ? <><span className="button-spinner" aria-hidden="true" /> Criando sua sala...</>
                  : <>Criar sala e convidar a turma <span aria-hidden="true">→</span></>}
              </button>
              {isCreatingRoom && <p className="creation-status" role="status">Preparando a sala. Isso pode levar alguns segundos.</p>}
              {queuePrompt && <div className="queue-offer" role="status">
                <strong>As salas estão ocupadas agora</strong>
                <p>Entre na fila e criaremos sua sala automaticamente assim que uma vaga abrir.</p>
                <div className="form-row">
                  <button className="button button-primary" type="button" onClick={() => void joinCreationQueue()}>Entrar na fila</button>
                  <button className="button button-secondary" type="button" onClick={() => {
                    setQueuePrompt(false);
                    setPendingRoomRequest(null);
                    setError('');
                  }}>Agora não</button>
                </div>
              </div>}
              <p className="setup-footnote">Até {config?.limits.maxPlayersPerRoom ?? 500} pessoas · Sem cadastro</p>
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
                <span className="field-label" id="join-avatar-label">Escolha seu avatar</span>
                <AvatarPicker value={avatar} onChange={changeAvatar} labelId="join-avatar-label" />
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
          <div className="center-panel game-panel">
            <div className="card lobby-card">
              <div className="lobby-top">
                <div>
                  <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> SALA ABERTA</p>
                  <div className="lobby-heading">
                    <h1>Chame a sua turma</h1>
                    <span className="room-code" aria-label={`Código da sala ${room.code}`}>{room.code}</span>
                  </div>
                  <p className="muted">A partida começa quando o mestre der o sinal.</p>
                </div>
                <div className="player-count"><strong>{room.playerCount}/{config?.limits.maxPlayersPerRoom ?? 500}</strong><span>{room.playerCount === 1 ? 'jogador' : 'jogadores'}</span></div>
              </div>
              {isMaster && <div className="invite-box">
                <div><span className="field-label">LINK DE CONVITE</span><a href={inviteLink}>{inviteLink}</a></div>
                <button className="button button-secondary" onClick={() => void copyInvite()}>Copiar link</button>
              </div>}
              {notice && <p className="lobby-notice">{notice}</p>}
              <div className="roster-heading"><h2>Na sala</h2><span>{room.playerCount} participante{room.playerCount === 1 ? '' : 's'}</span></div>
              <ul className="player-list">
                {room.players.map((player) => <li key={player.id}>
                  <PlayerAvatar avatar={player.avatar} size="sm" />
                  <span className="player-name">{player.nickname}{player.id === playerId && <small>Você</small>}</span>
                  {player.isMaster && <span className="master-badge">MESTRE</span>}
                </li>)}
              </ul>
              {isMaster ? <button className="button button-primary button-wide" onClick={() => void startGame()}>Começar partida <span>→</span></button> : <div className="waiting-note"><span className="pulse-dot" /> Aguardando o mestre iniciar...</div>}
              <p className="form-hint">{room.questionCount} perguntas · {room.timePerQuestionSeconds} segundos cada</p>
            </div>
          </div>
        )}

        {stage === 'countdown' && (
          <div className="center-panel"><div className="countdown-stage"><p className="eyebrow">PREPARE-SE</p><h1>A partida começa em</h1><div className="countdown-number" key={countdown}>{countdown}</div><p className="muted">Boa sorte para todo mundo!</p></div></div>
        )}

        {(stage === 'question' || stage === 'reveal') && question && (
          <div className="center-panel game-panel"><div className="card question-card" key={question.id}>
            <div className="question-meta">
              <span className="eyebrow question-category">
                <span className="category-emoji" aria-hidden="true">{categoryIcon(question.categoria)}</span>
                <span>{question.categoria.toUpperCase()}</span>
                <i>·</i>
                <span>PERGUNTA {question.number} DE {question.total}</span>
              </span>
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
          <div className="center-panel game-panel ranking-panel"><div className="card ranking-card">
            <div className="ranking-confetti" aria-hidden="true">
              {CONFETTI_PIECES.map((piece, index) => (
                <i
                  key={index}
                  style={{
                    '--x': piece.left,
                    '--delay': piece.delay,
                    '--duration': piece.duration,
                    '--rotate': piece.rotate,
                    '--color': piece.color
                  } as CSSProperties}
                />
              ))}
            </div>
            <div className="ranking-heading">
              <span className="trophy" aria-hidden="true">🏆</span>
              <p className="eyebrow">FIM DE JOGO</p>
              <h1>Esse é o pódio!</h1>
              <p className="ranking-subtitle">{ranking.length} jogador{ranking.length === 1 ? '' : 'es'} · {room?.questionCount ?? '—'} perguntas · {room?.timePerQuestionSeconds ?? '—'}s cada</p>
            </div>
            {myRankingRow && (
              <p className={`ranking-you ${myRankingRow.position === 1 ? 'is-winner' : ''}`}>
                {myRankingRow.position === 1 ? '★ Você levou o 1º lugar!' : `Você terminou em ${myRankingRow.position}º lugar`}
              </p>
            )}
            <div className="podium">
              {[ranking[1], ranking[0], ranking[2]].map((player) => player && (
                <div className={`podium-player podium-${player.position}`} key={player.id}>
                  <div className="podium-persona">
                    {player.position === 1 && <span className="podium-crown" aria-hidden="true">♛</span>}
                    <span className="podium-avatar" style={avatarStyle(player.avatar)} aria-hidden="true">{avatarById(player.avatar).emoji}</span>
                    <strong className="podium-nickname">{player.nickname}{player.id === playerId && <small>Você</small>}</strong>
                    <span className="podium-points">{player.points}<small>pts</small></span>
                  </div>
                  <div className="podium-step"><span>{player.position}</span></div>
                </div>
              ))}
            </div>
            <ol className="ranking-list">
              {ranking.map((player) => (
                <li key={player.id} className={player.id === playerId ? 'ranking-row-you' : ''}>
                  <span
                    className="rank-bar"
                    style={{ '--bar': `${Math.max(4, Math.round((player.points / rankingMaxPoints) * 100))}%` } as CSSProperties}
                    aria-hidden="true"
                  />
                  <PlayerAvatar avatar={player.avatar} size="xs" />
                  <span className="rank-position">{player.position}</span>
                  <span className="player-name">{player.nickname}{player.id === playerId && <small>Você</small>}</span>
                  <span className="rank-time">{(player.totalAnswerTimeMs / 1000).toFixed(1)} s</span>
                  <strong>{player.points} pts</strong>
                </li>
              ))}
            </ol>
            {isMaster
              ? <button className="button button-primary button-wide" onClick={() => void endGame()}>Encerrar partida e voltar ao início <span>→</span></button>
              : <p className="form-hint">Aguardando o mestre encerrar a partida.</p>}
          </div></div>
        )}
      </section>
      <footer className="footer"><span>QUEM SABE MAIS</span><span>Feito para jogar junto</span></footer>
    </main>
  );
}
