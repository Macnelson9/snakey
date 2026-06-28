export function Hud({ score, hi, onOpenSettings }: { score: number; hi: number; onOpenSettings: () => void }) {
  return (
    <>
      <div className="hud">
        <span className="wordmark">BUGA</span>
        <div className="hud-right">
          <button className="theme-btn" aria-label="Settings" onClick={onOpenSettings} />
        </div>
      </div>
      <div className="score-row">
        <span>SCORE <b>{score}</b></span>
        <span>HI <b>{hi}</b></span>
      </div>
    </>
  );
}
