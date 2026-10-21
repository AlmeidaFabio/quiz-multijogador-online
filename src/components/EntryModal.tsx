type EntryModalProps = {
  onClose: () => void;
  onContinue: () => void;
};

export function EntryModal({ onClose, onContinue }: EntryModalProps) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="entry-modal" role="dialog" aria-modal="true" aria-labelledby="entry-modal-title" aria-describedby="entry-modal-description">
        <button className="modal-close" type="button" aria-label="Fechar" autoFocus onClick={onClose}>×</button>
        <span className="modal-icon" aria-hidden="true">Q</span>
        <p className="eyebrow">VAMOS COMEÇAR</p>
        <h2 id="entry-modal-title">Como quer continuar?</h2>
        <p className="modal-description" id="entry-modal-description">Crie sua sala sem cadastro ou use sua conta para uma experiência personalizada.</p>
        <button className="button button-google" type="button" disabled aria-describedby="google-coming-soon">
          <span className="google-mark" aria-hidden="true">G</span>
          Continuar com Google
          <span className="coming-soon-badge">Em breve</span>
        </button>
        <p className="google-coming-soon" id="google-coming-soon">O acesso com Google será disponibilizado em breve.</p>
        <div className="modal-divider"><span>ou</span></div>
        <button className="button button-primary button-wide modal-continue" type="button" onClick={onContinue}>
          Continuar sem login <span aria-hidden="true">→</span>
        </button>
        <p className="modal-footnote">Sem conta, senha ou cadastro.</p>
      </section>
    </div>
  );
}
