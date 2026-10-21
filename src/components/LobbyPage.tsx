import type { RoomState } from '../types.ts';
import { PlayerAvatar } from './PlayerAvatar.tsx';

type LobbyPageProps = {
  room: RoomState;
  maxPlayers: number;
  isMaster: boolean;
  playerId: string;
  inviteLink: string;
  notice: string;
  onCopyInvite: () => void;
  onStartGame: () => void;
};

export function LobbyPage({ room, maxPlayers, isMaster, playerId, inviteLink, notice, onCopyInvite, onStartGame }: LobbyPageProps) {
  return (
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
          <div className="player-count"><strong>{room.playerCount}/{maxPlayers}</strong><span>{room.playerCount === 1 ? 'jogador' : 'jogadores'}</span></div>
        </div>
        {isMaster && <div className="invite-box">
          <div><span className="field-label">LINK DE CONVITE</span><a href={inviteLink}>{inviteLink}</a></div>
          <button className="button button-secondary" onClick={onCopyInvite}>Copiar link</button>
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
        {isMaster
          ? <button className="button button-primary button-wide" onClick={onStartGame}>Começar partida <span>→</span></button>
          : <div className="waiting-note"><span className="pulse-dot" /> Aguardando o mestre iniciar...</div>}
        <p className="form-hint">{room.questionCount} perguntas · {room.timePerQuestionSeconds} segundos cada</p>
      </div>
    </div>
  );
}
