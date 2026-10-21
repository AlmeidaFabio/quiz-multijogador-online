import { useEffect, useState } from 'react';
import type { PresentationTheme } from './types.ts';
import { Alerts } from './components/Alerts.tsx';
import { AppHeader } from './components/AppHeader.tsx';
import { CountdownPage } from './components/CountdownPage.tsx';
import { EntryModal } from './components/EntryModal.tsx';
import { JoinPage } from './components/JoinPage.tsx';
import { LandingPage } from './components/LandingPage.tsx';
import { LobbyPage } from './components/LobbyPage.tsx';
import { MessagePage } from './components/MessagePage.tsx';
import { QuestionPage } from './components/QuestionPage.tsx';
import { RankingPage } from './components/RankingPage.tsx';
import { SetupPage } from './components/SetupPage.tsx';
import { useQuizSession } from './game/useQuizSession.ts';
import { usePresentationSettings } from './hooks/usePresentationSettings.ts';

export default function App() {
  const presentation = usePresentationSettings();
  const game = useQuizSession(presentation.playSound);
  const [isEntryModalOpen, setIsEntryModalOpen] = useState(false);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);

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

  function handleEntryContinue() {
    setIsEntryModalOpen(false);
    game.startConfiguration();
  }

  function handleSelectTheme(theme: PresentationTheme) {
    presentation.selectTheme(theme);
    setIsThemeMenuOpen(false);
  }

  return (
    <main className="page-shell">
      <AppHeader
        theme={presentation.settings.theme}
        soundEnabled={presentation.settings.soundEnabled}
        motionEnabled={presentation.settings.motionEnabled}
        isThemeMenuOpen={isThemeMenuOpen}
        onGoHome={game.backHome}
        onToggleThemeMenu={() => setIsThemeMenuOpen((open) => !open)}
        onSelectTheme={handleSelectTheme}
        onToggleSound={presentation.toggleSound}
        onToggleMotion={presentation.toggleMotion}
      />

      <section className="content">
        <Alerts error={game.error} notice={game.notice} />

        {game.stage === 'home' && (
          <LandingPage
            totalQuestions={game.totalQuestions}
            categoryCount={game.config?.categories.length ?? 0}
            maxPlayers={game.config?.limits.maxPlayersPerRoom ?? 500}
            onStart={() => setIsEntryModalOpen(true)}
          />
        )}

        {isEntryModalOpen && game.stage === 'home' && (
          <EntryModal onClose={() => setIsEntryModalOpen(false)} onContinue={handleEntryContinue} />
        )}

        {game.stage === 'configuring' && (
          <SetupPage
            config={game.config}
            nickname={game.nickname}
            onNicknameChange={game.setNickname}
            avatar={game.avatar}
            onAvatarChange={game.changeAvatar}
            categories={game.categories}
            onToggleCategory={game.toggleCategory}
            questionCount={game.questionCount}
            onQuestionCountChange={game.setQuestionCount}
            timePerQuestionSeconds={game.timePerQuestionSeconds}
            onTimePerQuestionChange={game.setTimePerQuestionSeconds}
            minimumQuestions={game.minimumQuestions}
            maxAvailableQuestions={game.maxAvailableQuestions}
            selectedCount={game.selectedCount}
            canCreateRoom={game.canCreateRoom}
            isCreatingRoom={game.isCreatingRoom}
            queuePrompt={game.queuePrompt}
            onBack={game.returnToLanding}
            onSubmit={game.createGame}
            onJoinQueue={() => void game.joinCreationQueue()}
            onDismissQueue={game.dismissQueuePrompt}
          />
        )}

        {game.stage === 'joining' && (
          <JoinPage
            nickname={game.nickname}
            avatar={game.avatar}
            onNicknameChange={game.setNickname}
            onAvatarChange={game.changeAvatar}
            onSubmit={game.joinGame}
          />
        )}

        {game.stage === 'recovering' && (
          <MessagePage
            icon="↻"
            eyebrow="RECONECTANDO"
            title="Recuperando sua partida"
            description={game.error || 'Estamos restaurando seu lugar e o estado atual do jogo.'}
          />
        )}

        {game.stage === 'queue' && (
          <MessagePage
            icon="↻"
            eyebrow="FILA DE CRIAÇÃO DE SALA"
            title="Você está na fila"
            description={`Sua posição: ${game.queuePosition ?? 'atualizando'} de ${game.queueTotal}. Sua sala será criada automaticamente quando houver uma vaga.`}
          >
            <button className="button button-secondary" onClick={() => void game.leaveCreationQueue()}>Sair da fila</button>
          </MessagePage>
        )}

        {game.stage === 'invalid' && (
          <MessagePage
            icon="✕"
            eyebrow="CONVITE INDISPONÍVEL"
            title="Não encontramos essa partida"
            description={game.error || 'O convite pode ter expirado ou a partida já começou.'}
          >
            <button className="button button-primary" onClick={game.backHome}>Voltar ao início</button>
          </MessagePage>
        )}

        {game.stage === 'lobby' && game.room && (
          <LobbyPage
            room={game.room}
            maxPlayers={game.config?.limits.maxPlayersPerRoom ?? 500}
            isMaster={game.isMaster}
            playerId={game.playerId}
            inviteLink={game.inviteLink}
            notice={game.notice}
            onCopyInvite={() => void game.copyInvite()}
            onStartGame={() => void game.startGame()}
          />
        )}

        {game.stage === 'countdown' && <CountdownPage countdown={game.countdown} />}

        {(game.stage === 'question' || game.stage === 'reveal') && game.question && (
          <QuestionPage
            question={game.question}
            stage={game.stage === 'reveal' ? 'reveal' : 'question'}
            selected={game.selected}
            correctIndex={game.correctIndex}
            answerCorrect={game.answerCorrect}
            remainingSeconds={game.remainingSeconds}
            playerCount={game.room?.playerCount ?? 1}
            onAnswer={(index) => void game.submitAnswer(index)}
          />
        )}

        {game.stage === 'ranking' && (
          <RankingPage
            ranking={game.ranking}
            playerId={game.playerId}
            isMaster={game.isMaster}
            room={game.room}
            onEndGame={() => void game.endGame()}
          />
        )}
      </section>
      <footer className="footer"><span>QUEM SABE MAIS</span><span>Feito para jogar junto</span></footer>
    </main>
  );
}
