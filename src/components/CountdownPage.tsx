export function CountdownPage({ countdown }: { countdown: number }) {
  return (
    <div className="center-panel">
      <div className="countdown-stage">
        <p className="eyebrow">PREPARE-SE</p>
        <h1>A partida começa em</h1>
        <div className="countdown-number" key={countdown}>{countdown}</div>
        <p className="muted">Boa sorte para todo mundo!</p>
      </div>
    </div>
  );
}
