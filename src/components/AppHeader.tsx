import { THEME_OPTIONS } from '../config/presentation.ts';
import type { PresentationTheme } from '../types.ts';
import { MotionIcon, SoundIcon, ThemeIcon } from './icons.tsx';

type AppHeaderProps = {
  theme: PresentationTheme;
  soundEnabled: boolean;
  motionEnabled: boolean;
  isThemeMenuOpen: boolean;
  onGoHome: () => void;
  onToggleThemeMenu: () => void;
  onSelectTheme: (theme: PresentationTheme) => void;
  onToggleSound: () => void;
  onToggleMotion: () => void;
};

export function AppHeader({
  theme,
  soundEnabled,
  motionEnabled,
  isThemeMenuOpen,
  onGoHome,
  onToggleThemeMenu,
  onSelectTheme,
  onToggleSound,
  onToggleMotion
}: AppHeaderProps) {
  return (
    <header className="topbar">
      <button className="brand" onClick={onGoHome} aria-label="Voltar à página inicial">
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
            onClick={onToggleThemeMenu}
          >
            <ThemeIcon theme={theme} />
            <span className="theme-caret" aria-hidden="true">▾</span>
          </button>
          <div id="theme-options" className={`theme-switcher ${isThemeMenuOpen ? 'theme-switcher-open' : ''}`}>
            {THEME_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`theme-option ${theme === value ? 'is-active' : ''}`}
                onClick={() => onSelectTheme(value)}
                aria-label={label}
                title={label}
                aria-pressed={theme === value}
              >
                <ThemeIcon theme={value} />
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="settings-toggle"
          aria-pressed={soundEnabled}
          aria-label={soundEnabled ? 'Desativar sons' : 'Ativar sons'}
          title={soundEnabled ? 'Desativar sons' : 'Ativar sons'}
          onClick={onToggleSound}
        >
          <SoundIcon enabled={soundEnabled} /><span>Sons</span>
        </button>
        <button
          type="button"
          className="settings-toggle"
          aria-pressed={motionEnabled}
          aria-label={motionEnabled ? 'Reduzir animações' : 'Ativar animações'}
          title={motionEnabled ? 'Reduzir animações' : 'Ativar animações'}
          onClick={onToggleMotion}
        >
          <MotionIcon enabled={motionEnabled} /><span>Animações</span>
        </button>
      </div>
    </header>
  );
}
