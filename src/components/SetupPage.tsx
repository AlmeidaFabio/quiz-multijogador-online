import type { FormEvent } from 'react';
import type { AvatarId } from '../../shared/avatars.ts';
import { categoryIcon } from '../config/categories.ts';
import type { GameConfig } from '../types.ts';
import { AvatarPicker } from './AvatarPicker.tsx';

type SetupPageProps = {
  config: GameConfig | null;
  nickname: string;
  onNicknameChange: (value: string) => void;
  avatar: AvatarId;
  onAvatarChange: (avatar: AvatarId) => void;
  categories: string[];
  onToggleCategory: (category: string) => void;
  questionCount: number;
  onQuestionCountChange: (value: number) => void;
  timePerQuestionSeconds: number;
  onTimePerQuestionChange: (value: number) => void;
  minimumQuestions: number;
  maxAvailableQuestions: number;
  selectedCount: number;
  canCreateRoom: boolean;
  isCreatingRoom: boolean;
  queuePrompt: boolean;
  onBack: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onJoinQueue: () => void;
  onDismissQueue: () => void;
};

export function SetupPage({
  config,
  nickname,
  onNicknameChange,
  avatar,
  onAvatarChange,
  categories,
  onToggleCategory,
  questionCount,
  onQuestionCountChange,
  timePerQuestionSeconds,
  onTimePerQuestionChange,
  minimumQuestions,
  maxAvailableQuestions,
  selectedCount,
  canCreateRoom,
  isCreatingRoom,
  queuePrompt,
  onBack,
  onSubmit,
  onJoinQueue,
  onDismissQueue
}: SetupPageProps) {
  return (
    <div className="config-page">
      <div className="config-page-heading">
        <button className="back-link" type="button" onClick={onBack}><span aria-hidden="true">←</span> Voltar</button>
        <div className="config-step" aria-label="Etapa 2 de 2">
          <span className="config-step-done">1</span><i /><span className="config-step-current">2</span>
        </div>
        <p className="eyebrow">ETAPA 2 DE 2</p>
        <h1>Configure sua sala</h1>
        <p className="config-intro">Escolha as categorias, o ritmo e prepare a partida para sua turma.</p>
      </div>
      <form className="card setup-card" onSubmit={onSubmit}>
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
            onChange={(event) => onNicknameChange(event.target.value)}
            placeholder="Ex.: Fabi"
            disabled={isCreatingRoom}
          />
          <p className="field-help">De 2 a 20 caracteres. Você também participa da partida.</p>
        </div>
        <div className="setup-field">
          <span className="field-label" id="setup-avatar-label">Escolha seu avatar</span>
          <AvatarPicker value={avatar} onChange={onAvatarChange} labelId="setup-avatar-label" />
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
                <input type="checkbox" checked={categories.includes(category)} onChange={() => onToggleCategory(category)} />
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
              onChange={(event) => onQuestionCountChange(event.target.value === '' ? 0 : Number(event.target.value))}
              aria-describedby="question-count-help"
              disabled={isCreatingRoom}
            />
            <small className="field-help" id="question-count-help">De {minimumQuestions} a {Math.max(minimumQuestions, maxAvailableQuestions)}</small>
          </label>
          <label><span className="field-label">Tempo por pergunta</span>
            <select value={timePerQuestionSeconds} onChange={(event) => onTimePerQuestionChange(Number(event.target.value))} disabled={isCreatingRoom}>
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
            <button className="button button-primary" type="button" onClick={onJoinQueue}>Entrar na fila</button>
            <button className="button button-secondary" type="button" onClick={onDismissQueue}>Agora não</button>
          </div>
        </div>}
        <p className="setup-footnote">Até {config?.limits.maxPlayersPerRoom ?? 500} pessoas · Sem cadastro</p>
      </form>
    </div>
  );
}
