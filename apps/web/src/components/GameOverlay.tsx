import type { SettleResponse } from "@/lib/client/api.ts";

function gd(amountWei: string): string {
  // 18-decimal wei → short G$ string, integer math so no float drift.
  const w = BigInt(amountWei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n) / 10n ** 16n; // 2 dp
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function GameOverlay({
  phase,
  result,
  practice,
  settling,
  hasWallet,
  onStart,
  onLogin,
}: {
  phase: "idle" | "gameover";
  result: SettleResponse | null;
  practice: boolean;
  settling: boolean;
  hasWallet: boolean;
  onStart: () => void;
  onLogin: () => void;
}) {
  if (phase === "idle") {
    if (!hasWallet) {
      return (
        <div className="overlay">
          <div className="wordmark" style={{ fontSize: 22 }}>BUGA</div>
          <p style={{ fontSize: 12, opacity: 0.75, margin: 0 }}>
            The Nokia snake · earn G$ for every run
          </p>
          <div className="wallet-cta">
            <span className="wallet-cta-label">Connect a wallet to start earning</span>
            <button className="btn" onClick={onLogin} style={{ width: "100%", maxWidth: 200 }}>
              CONNECT WALLET
            </button>
          </div>
          <button className="btn-outline" onClick={onStart}>
            Play without wallet
          </button>
        </div>
      );
    }
    return (
      <div className="overlay">
        <div className="wordmark" style={{ fontSize: 22 }}>BUGA</div>
        <p style={{ fontSize: 12, opacity: 0.8 }}>swipe / arrows to steer · eat the dot</p>
        <button className="btn" onClick={onStart}>PLAY</button>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div style={{ fontSize: 14, letterSpacing: ".1em" }}>GAME OVER</div>

      {settling && (
        <div style={{ fontSize: 12, opacity: 0.8, margin: "8px 0" }}>claiming G$…</div>
      )}

      {!settling && result?.status === "accepted" && (
        <div>
          <div style={{ fontSize: 28 }}>{result.score}</div>
          <div style={{ fontSize: 12 }}>earned {gd(result.amount)} G$</div>
          {result.txHash && (
            <a
              href={`https://celoscan.io/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, opacity: 0.7, display: "block", marginTop: 4 }}
            >
              view on Celoscan ↗
            </a>
          )}
        </div>
      )}

      {!settling && result?.status === "no_reward" && (
        <div>
          <div style={{ fontSize: 28 }}>{result.score}</div>
          <div style={{ fontSize: 12 }}>
            {result.reason === "below_bar" && "below the reward bar"}
            {result.reason === "cap_reached" && "daily cap reached"}
            {result.reason === "not_verified" && (
              <>
                verify to earn G${" "}
                <a
                  href="https://wallet.gooddollar.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ opacity: 0.8 }}
                >
                  get verified ↗
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {!settling && result?.status === "rejected" && (
        <div style={{ fontSize: 12 }}>run not counted: {result.reason}</div>
      )}

      {practice && (
        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
          {!hasWallet ? (
            <>
              <button className="btn-link" onClick={onLogin}>connect wallet</button>
              {" "}to earn G$
            </>
          ) : (
            "practice mode — offline"
          )}
        </div>
      )}

      <button className="btn" onClick={onStart} disabled={settling}>
        {settling ? "…" : "PLAY AGAIN"}
      </button>
    </div>
  );
}
