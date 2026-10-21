import type { PresentationSettings, PresentationTheme } from '../types.ts';

export const PRESENTATION_STORAGE_KEY = 'quiz-presentation-settings';

export const DEFAULT_PRESENTATION_SETTINGS: PresentationSettings = {
  theme: 'neon',
  soundEnabled: true,
  motionEnabled: true
};

export const THEME_OPTIONS: Array<{ value: PresentationTheme; label: string }> = [
  { value: 'classic', label: 'Tema claro' },
  { value: 'midnight', label: 'Tema noite' },
  { value: 'neon', label: 'Tema neon' }
];

export function isPresentationTheme(value: unknown): value is PresentationTheme {
  return value === 'classic' || value === 'midnight' || value === 'neon';
}

export function readPresentationSettings(): PresentationSettings {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(PRESENTATION_STORAGE_KEY) ?? 'null');
    if (typeof value !== 'object' || value === null) return DEFAULT_PRESENTATION_SETTINGS;
    const settings = value as Partial<PresentationSettings>;
    return {
      theme: isPresentationTheme(settings.theme) ? settings.theme : DEFAULT_PRESENTATION_SETTINGS.theme,
      soundEnabled: settings.soundEnabled !== false,
      motionEnabled: settings.motionEnabled !== false
    };
  } catch {
    return DEFAULT_PRESENTATION_SETTINGS;
  }
}
