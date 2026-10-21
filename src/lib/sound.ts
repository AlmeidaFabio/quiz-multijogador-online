export type SoundKind =
  | 'click'
  | 'pop'
  | 'correct'
  | 'wrong'
  | 'notice'
  | 'countdown'
  | 'tick'
  | 'start'
  | 'finish';

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

export class SoundEngine {
  private context: AudioContext | null = null;

  play(kind: SoundKind, enabled: boolean): void {
    if (!enabled) return;
    const AudioCtor = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor || typeof AudioCtor !== 'function') return;
    if (!this.context) {
      this.context = new AudioCtor();
    }
    const context = this.context;
    if (context.state === 'suspended') {
      void context.resume();
    }

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
}
