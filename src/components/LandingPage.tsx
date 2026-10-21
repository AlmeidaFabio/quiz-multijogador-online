import { PlayerAvatar } from './PlayerAvatar.tsx';

type LandingPageProps = {
  totalQuestions: number;
  categoryCount: number;
  maxPlayers: number;
  onStart: () => void;
};

export function LandingPage({ totalQuestions, categoryCount, maxPlayers, onStart }: LandingPageProps) {
  return (
    <div className="landing-layout">
      <div className="hero-copy">
        <p className="eyebrow"><span className="live-dot" aria-hidden="true" /> QUIZ AO VIVO · MULTIJOGADOR</p>
        <h1>Quem sabe mais<br />e responde <em>mais rápido?</em></h1>
        <p className="hero-description">Crie uma sala, convide a turma e descubra quem leva o pódio. Sem cadastro, direto no navegador.</p>
        <div className="hero-actions">
          <button className="button button-primary landing-cta" type="button" onClick={onStart}>
            Criar sala e jogar <span className="cta-arrow" aria-hidden="true">→</span>
          </button>
          <span className="hero-note">Grátis · sem instalar nada</span>
        </div>
        <div className="hero-stats">
          <span className="hero-stat"><strong>{totalQuestions || '—'}</strong><small>perguntas</small></span>
          <span className="hero-stat"><strong>{categoryCount || '—'}</strong><small>categorias</small></span>
          <span className="hero-stat"><strong>{maxPlayers}</strong><small>jogadores por sala</small></span>
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
            <PlayerAvatar avatar="fox" size="xs" />
            <PlayerAvatar avatar="panda" size="xs" />
            <PlayerAvatar avatar="frog" size="xs" />
            <small>+12 na sala</small>
          </div>
        </div>
        <span className="preview-float preview-float-top">⚡</span>
        <span className="preview-float preview-float-bottom">+250</span>
      </div>
    </div>
  );
}
