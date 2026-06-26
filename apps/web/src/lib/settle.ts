// settle.ts — the authoritative settlement path (CLAUDE.md settle flow step 3-4).
// It reloads the session, replays the input log on the SAME shared engine the
// client used (so the client-claimed score is never needed nor trusted), runs
// the integrity gates, and — only if a payout is warranted — signs an EIP-712
// voucher. The request body carries (runId, inputs) and nothing else: there is
// deliberately no field in which a client could assert a score.
import { simulate, MAX_TICKS, type Input } from "@nokiadot/engine";
import type { Hex } from "viem";
import type { SessionStore } from "./session/store.ts";
import { rewardForScore, REWARD_PARAMS, type RewardParams } from "./reward.ts";
import { signVoucher, type SignedVoucher, type VoucherContext } from "./voucher.ts";
import type { IdentityVerifier } from "./identity/verifier.ts";

export interface SettleParams {
  store: SessionStore;
  /** The crown-jewel scorer signing key (kept in KMS/HSM in production). */
  scorerPrivateKey: Hex;
  voucherContext: VoucherContext;
  /** On-chain GoodDollar identity gate; the daily cap is keyed on its root. */
  identityVerifier: IdentityVerifier;
  /** Hard per-identity daily payout cap, in G$ wei. */
  dailyCap: bigint;
  /** Minimum real ms a single engine tick can represent (wall-clock plausibility). */
  minMsPerTick: number;
  /** How long a signed voucher stays redeemable, in ms. */
  voucherTtlMs: number;
  rewardParams?: RewardParams;
  /** Inputs-per-tick ratio above which a run is flagged (not blocked) for review. */
  maxInputRatio?: number;
  /** Injectable clock; the ONLY trusted time source is the server's. */
  now?: () => number;
}

export interface SettleRequest {
  runId: string;
  inputs: Input[];
}

export type RejectReason =
  | "invalid_input"
  | "unknown_session"
  | "replay"
  | "implausible_timing";

export type NoRewardReason = "below_bar" | "cap_reached" | "not_verified";

export type SettleResult =
  | {
      status: "accepted";
      score: number;
      ticks: number;
      foodEaten: number;
      died: boolean;
      amount: bigint;
      flagged: boolean;
      flags: string[];
      signed: SignedVoucher;
    }
  | {
      status: "no_reward";
      reason: NoRewardReason;
      score: number;
      ticks: number;
      amount: bigint;
    }
  | { status: "rejected"; reason: RejectReason };

function validInputs(inputs: unknown): inputs is Input[] {
  if (!Array.isArray(inputs)) return false;
  if (inputs.length > MAX_TICKS) return false; // bounded work
  for (const i of inputs) {
    if (typeof i !== "object" || i === null) return false;
    const { tick, dir } = i as Record<string, unknown>;
    if (typeof tick !== "number" || !Number.isInteger(tick) || tick < 0) return false;
    if (dir !== 0 && dir !== 1 && dir !== 2 && dir !== 3) return false;
  }
  return true;
}

function dayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

export async function settle(p: SettleParams, req: SettleRequest): Promise<SettleResult> {
  const now = p.now ?? Date.now;
  const maxInputRatio = p.maxInputRatio ?? 0.8;
  const rewardParams = p.rewardParams ?? REWARD_PARAMS;

  if (!validInputs(req.inputs)) return { status: "rejected", reason: "invalid_input" };

  const session = await p.store.get(req.runId);
  if (!session) return { status: "rejected", reason: "unknown_session" };

  // Authoritative replay on the shared engine. The claimed score does not exist.
  const result = simulate(session.seed, req.inputs);

  // Soft heuristics: raise review flags, never hard-block (CLAUDE.md step 3).
  const flags: string[] = [];
  const maxTick = req.inputs.reduce((m, i) => Math.max(m, i.tick), -1);
  if (maxTick > result.ticks) flags.push("future_inputs");
  if (result.ticks > 0 && req.inputs.length > result.ticks * maxInputRatio) {
    flags.push("high_input_density");
  }
  const flagged = flags.length > 0;

  const reward = rewardForScore(result.score, rewardParams);
  if (reward === 0n) {
    // Sub-bar runs are deterministic and earn nothing; no need to spend the
    // identity RPC or burn the session — they can be replayed harmlessly.
    return { status: "no_reward", reason: "below_bar", score: result.score, ticks: result.ticks, amount: 0n };
  }

  // Identity gate (CLAUDE.md decision #4: before payout, never before play). The
  // server derives the verified-human identity on-chain — the client cannot
  // assert it. Checked BEFORE consume so an unverified claim does not burn the
  // run: the player face-verifies, then re-submits the same run and is paid.
  const identity = await p.identityVerifier.check(session.player);
  if (!identity.verified) {
    return { status: "no_reward", reason: "not_verified", score: result.score, ticks: result.ticks, amount: 0n };
  }

  // Claim the session atomically — exactly one paid settle per session. A second
  // attempt (or a concurrent race) loses here.
  const claimed = await p.store.consume(req.runId);
  if (!claimed) return { status: "rejected", reason: "replay" };

  // Wall-clock plausibility, server timestamps only: a run of N ticks cannot
  // have been produced faster than N * minMsPerTick of real time. Checked AFTER
  // consume so an implausibly-fast run is burned — otherwise it could be replayed
  // later once enough real time had elapsed to look plausible.
  const elapsed = now() - session.issuedAt;
  if (elapsed < result.ticks * p.minMsPerTick) {
    return { status: "rejected", reason: "implausible_timing" };
  }

  // Hard daily cap, keyed on the GoodDollar root so linked wallets share one
  // bucket. Clamp the payout to what's left today.
  const day = dayKey(now());
  const spent = await p.store.getDailyTotal(identity.root, day);
  const remaining = p.dailyCap - spent;
  if (remaining <= 0n) {
    return { status: "no_reward", reason: "cap_reached", score: result.score, ticks: result.ticks, amount: 0n };
  }
  const amount = reward < remaining ? reward : remaining;
  await p.store.addDailyTotal(identity.root, day, amount);

  const deadline = BigInt(now() + p.voucherTtlMs) / 1000n; // unix seconds
  const signed = await signVoucher(
    p.scorerPrivateKey,
    { player: session.player, runId: session.runId, amount, deadline },
    p.voucherContext,
  );

  return {
    status: "accepted",
    score: result.score,
    ticks: result.ticks,
    foodEaten: result.foodEaten,
    died: result.died,
    amount,
    flagged,
    flags,
    signed,
  };
}
