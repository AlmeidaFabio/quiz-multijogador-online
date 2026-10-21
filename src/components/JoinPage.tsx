import type { FormEvent } from 'react';
import type { AvatarId } from '../../shared/avatars.ts';
import { AvatarPicker } from './AvatarPicker.tsx';

type JoinPageProps = {
  nickname: string;
  avatar: AvatarId;
  onNicknameChange: (value: string) => void;
  onAvatarChange: (avatar: AvatarId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

export function JoinPage({ nickname, avatar, onNicknameChange, onAvatarChange, onSubmit }: JoinPageProps) {
  return (
    <div className="center-panel">
      <div className="card join-card">
        <p className="eyebrow">VOCÊ FOI CONVIDADO</p>
        <h1>Entre na partida</h1>
        <p className="muted">Escolha como a turma vai chamar você.</p>
        <form onSubmit={onSubmit}>
          <span className="field-label" id="join-avatar-label">Escolha seu avatar</span>
          <AvatarPicker value={avatar} onChange={onAvatarChange} labelId="join-avatar-label" />
          <label className="field-label" htmlFor="join-nickname">Seu nickname</label>
          <input
            id="join-nickname"
            autoFocus
            required
            minLength={2}
            maxLength={20}
            value={nickname}
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="Ex.: Fabi"
          />
          <p className="form-hint">Nicknames com palavrões ou termos ofensivos não são permitidos.</p>
          <button className="button button-primary button-wide" type="submit">Entrar na sala <span>→</span></button>
        </form>
      </div>
    </div>
  );
}
