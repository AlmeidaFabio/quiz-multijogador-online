import { useCallback, useEffect, useRef, useState } from 'react';
import { PRESENTATION_STORAGE_KEY, readPresentationSettings } from '../config/presentation.ts';
import { SoundEngine } from '../lib/sound.ts';
import type { SoundKind } from '../lib/sound.ts';
import type { PresentationSettings, PresentationTheme } from '../types.ts';

export function usePresentationSettings() {
  const [settings, setSettings] = useState<PresentationSettings>(readPresentationSettings);
  const soundEngineRef = useRef<SoundEngine | null>(null);

  const playSound = useCallback((kind: SoundKind) => {
    soundEngineRef.current ??= new SoundEngine();
    soundEngineRef.current.play(kind, settings.soundEnabled);
  }, [settings.soundEnabled]);

  useEffect(() => {
    window.localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(settings));
    document.body.dataset.theme = settings.theme;
    document.body.dataset.motion = settings.motionEnabled ? 'enabled' : 'reduced';
  }, [settings]);

  const selectTheme = useCallback((theme: PresentationTheme) => {
    playSound('click');
    setSettings((current) => ({ ...current, theme }));
  }, [playSound]);

  const toggleSound = useCallback(() => {
    playSound('click');
    setSettings((current) => ({ ...current, soundEnabled: !current.soundEnabled }));
  }, [playSound]);

  const toggleMotion = useCallback(() => {
    playSound('click');
    setSettings((current) => ({ ...current, motionEnabled: !current.motionEnabled }));
  }, [playSound]);

  return { settings, playSound, selectTheme, toggleSound, toggleMotion };
}
