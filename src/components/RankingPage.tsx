import type { CSSProperties } from 'react';
import { CONFETTI_PIECES } from '../config/ranking.ts';
import { avatarEmoji, avatarStyle } from '../lib/avatar.ts';
import type { RankingRow, RoomState } from '../types.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

type RankingPageProps = {
  ranking: RankingRow[];
  playerId: string;
  isMaster: boolean;
  room: RoomState | null;
  onEndGame: () => void;
};

export function RankingPage({ ranking, playerId, isMaster, room, onEndGame }: RankingPageProps) {
  const maxPoints = Math.max(1, ...ranking.map((player) => player.points));
  const currentPlayer = ranking.find((player) => player.id === playerId);

  return (
    <div className="center-panel game-panel ranking-panel">
      <div className="card ranking-card">
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
          <p className="ranking-subtitle">
            {ranking.length} jogador{ranking.length === 1 ? '' : 'es'} · {room?.questionCount ?? '—'} perguntas · {room?.timePerQuestionSeconds ?? '—'}s cada
          </p>
        </div>
        {currentPlayer && (
          <p className={`ranking-you ${currentPlayer.position === 1 ? 'is-winner' : ''}`}>
            {currentPlayer.position === 1 ? '★ Você levou o 1º lugar!' : `Você terminou em ${currentPlayer.position}º lugar`}
          </p>
        )}
        <div className="podium">
          {[ranking[1], ranking[0], ranking[2]].map((player) => player && (
            <div className={`podium-player podium-${player.position}`} key={player.id}>
              <div className="podium-persona">
                {player.position === 1 && <span className="podium-crown" aria-hidden="true">♛</span>}
                <span className="podium-avatar" style={avatarStyle(player.avatar)} aria-hidden="true">{avatarEmoji(player.avatar)}</span>
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
                style={{ '--bar': `${Math.max(4, Math.round((player.points / maxPoints) * 100))}%` } as CSSProperties}
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
          ? <button className="button button-primary button-wide" onClick={onEndGame}>Encerrar partida e voltar ao início <span>→</span></button>
          : <p className="form-hint">Aguardando o mestre encerrar a partida.</p>}
      </div>
    </div>
  );
}
