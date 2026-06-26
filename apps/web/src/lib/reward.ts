// reward.ts — the payout curve, and therefore the project's actual anti-bot
// mechanism (CLAUDE.md decision #5). Payouts are sub-linear in score and hit a
// hard per-run ceiling, so a bot scoring 99,999 earns no more than a human who
// merely reached the saturation point. Combined with the per-identity daily cap
// (enforced statefully in settle) and identity gating, botting earns nothing
// extra and is not worth the effort.
//
// All math is integer/bigint in G$ wei (18 decimals) — no floats, mirroring the
// engine's determinism discipline so the same number is reproducible anywhere.

export const G$_DECIMALS = 18;

/** Convert whole G$ tokens to 18-decimal wei. */
export function G$(whole: number): bigint {
  return BigInt(whole) * 10n ** BigInt(G$_DECIMALS);
}

/** Integer floor square root for non-negative bigints (Newton's method). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt: negative input");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

export interface RewardParams {
  /** Minimum score to earn anything ("clearing the bar"). */
  qualifyingScore: number;
  /** G$ wei paid per unit of sqrt(score) in the growth region. */
  perSqrt: bigint;
  /** Hard per-run ceiling in G$ wei. */
  maxPerRun: bigint;
  /** Smallest score whose uncapped reward already reaches maxPerRun. */
  saturatingScore: number;
}

// Demo-tier economics. Tunable per epoch; the curve shape is what matters:
//   reward(score) = min(perSqrt * floor(sqrt(score)), maxPerRun), or 0 below the bar.
//   perSqrt = 0.1 G$, maxPerRun = 2 G$  =>  saturates at score 400 (40 food),
//   since 0.1 * sqrt(400) = 0.1 * 20 = 2 G$.
export const REWARD_PARAMS: RewardParams = {
  qualifyingScore: 50,
  perSqrt: G$(1) / 10n,
  maxPerRun: G$(2),
  saturatingScore: 400,
};

/**
 * Authoritative reward for an authoritative score (never a client-claimed one).
 * The caller still clamps the result to the identity's remaining daily cap.
 */
export function rewardForScore(score: number, p: RewardParams = REWARD_PARAMS): bigint {
  if (score < p.qualifyingScore) return 0n;
  const raw = p.perSqrt * isqrt(BigInt(score));
  return raw < p.maxPerRun ? raw : p.maxPerRun;
}
