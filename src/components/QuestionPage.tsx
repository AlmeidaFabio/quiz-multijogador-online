import { categoryIcon } from '../config/categories.ts';
import type { Question } from '../types.ts';

type QuestionPageProps = {
  question: Question;
  stage: 'question' | 'reveal';
  selected: number | null;
  correctIndex: number | null;
  answerCorrect: boolean | null;
  remainingSeconds: number;
  playerCount: number;
  onAnswer: (index: number) => void;
};

export function QuestionPage({
  question,
  stage,
  selected,
  correctIndex,
  answerCorrect,
  remainingSeconds,
  playerCount,
  onAnswer
}: QuestionPageProps) {
  return (
    <div className="center-panel game-panel">
      <div className="card question-card" key={question.id}>
        <div className="question-meta">
          <span className="eyebrow question-category">
            <span className="category-emoji" aria-hidden="true">{categoryIcon(question.categoria)}</span>
            <span>{question.categoria.toUpperCase()}</span>
            <i>·</i>
            <span>PERGUNTA {question.number} DE {question.total}</span>
          </span>
          <span className={`timer ${remainingSeconds <= 5 ? 'timer-urgent' : ''}`} aria-label={`${remainingSeconds} segundos`}>
            {stage === 'reveal' ? '✓' : remainingSeconds}
          </span>
        </div>
        <div className="progress-track"><span style={{ width: `${((question.number - 1) / question.total) * 100}%` }} /></div>
        <h1>{question.enunciado}</h1>
        <div className="answer-grid">
          {question.alternativas.map((alternative, index) => {
            const isCorrect = correctIndex === index;
            const isWrongSelection = selected === index && correctIndex !== null && !isCorrect;
            return <button
              key={`${question.id}-${index}`}
              className={`answer-option ${selected === index ? 'answer-selected' : ''} ${isCorrect ? 'answer-correct' : ''} ${isWrongSelection ? 'answer-wrong' : ''}`}
              disabled={stage === 'reveal' || selected !== null || remainingSeconds <= 0}
              onClick={() => onAnswer(index)}
            >
              <span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{alternative}</span>
              {isCorrect && <span className="answer-mark">✓</span>}
            </button>;
          })}
        </div>
        <div className="question-foot">
          {stage === 'reveal'
            ? <strong className={answerCorrect ? 'result-correct' : 'result-wrong'}>
              {answerCorrect === null
                ? `Resposta: ${question.alternativas[correctIndex ?? 0]}`
                : answerCorrect ? 'Você acertou!' : `A resposta era: ${question.alternativas[correctIndex ?? 0]}`}
            </strong>
            : <span>{selected === null ? 'Toque em uma alternativa para responder' : 'Resposta enviada! Aguarde o tempo terminar.'}</span>}
          <span>{playerCount} jogando</span>
        </div>
      </div>
    </div>
  );
}
