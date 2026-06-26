import type { SettleResponse } from "@/lib/client/api.ts";

function gd(amountWei: string): string {
  // 18-decimal wei -> short G$ string, integer math so no float drift.
  const w = BigInt(amountWei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n) / 10n ** 16n; // 2 dp
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function GameOverlay({
  phase, result, practice, onStart,
}: { phase: "idle" | "gameover"; result: SettleResponse | null; practice: boolean; onStart: () => void }) {
  if (phase === "idle") {
    return (
      <div className="overlay">
        <div className="wordmark" style={{ fontSize: 22 }}>NOKIADOT</div>
        <p style={{ fontSize: 12, opacity: .8 }}>swipe / arrows to steer · eat the dot</p>
        <button className="btn" onClick={onStart}>PLAY</button>
      </div>
    );
  }
  return (
    <div className="overlay">
      <div style={{ fontSize: 14, letterSpacing: ".1em" }}>GAME OVER</div>
      {result?.status === "accepted" && (
        <div><div style={{ fontSize: 28 }}>{result.score}</div><div style={{ fontSize: 12 }}>earned {gd(result.amount)} G$</div></div>
      )}
      {result?.status === "no_reward" && (
        <div><div style={{ fontSize: 28 }}>{result.score}</div><div style={{ fontSize: 12 }}>{
          result.reason === "below_bar" ? "below the reward bar" :
          result.reason === "not_verified" ? "verify to earn (later)" : "daily cap reached"
        }</div></div>
      )}
      {result?.status === "rejected" && <div style={{ fontSize: 12 }}>run not counted: {result.reason}</div>}
      {practice && <div style={{ fontSize: 11, opacity: .7 }}>practice mode — offline</div>}
      <button className="btn" onClick={onStart}>PLAY AGAIN</button>
    </div>
  );
}
