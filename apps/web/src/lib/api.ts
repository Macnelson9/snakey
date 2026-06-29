// api.ts — pure (de)serialization at the HTTP boundary, kept out of the route
// handlers so it is unit-testable without the Next runtime. Vouchers carry
// bigint amount/deadline; everything crossing the wire is encoded as a decimal
// string so JSON.stringify succeeds and the client gets exact, contract-ready
// values.
import type { Address, Hex } from "viem";
import type { Input } from "@buga/engine";
import type { SessionRecord } from "./session/store.ts";
import type { NoRewardReason, RejectReason, SettleResult } from "./settle.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
}

export interface SessionBody {
  player: Address;
}

export function parseSessionBody(body: unknown): Parsed<SessionBody> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "body must be an object" };
  if (typeof b.player !== "string" || !ADDRESS_RE.test(b.player)) {
    return { ok: false, error: "player must be a 0x address" };
  }
  // No client-supplied identity: the server derives the verified-human identity
  // on-chain at settle (the GoodDollar gate), so it can never be spoofed here.
  return { ok: true, value: { player: b.player as Address } };
}

export interface SettleBody {
  runId: Hex;
  inputs: Input[];
}

export function parseSettleBody(body: unknown): Parsed<SettleBody> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "body must be an object" };
  if (typeof b.runId !== "string" || !BYTES32_RE.test(b.runId)) {
    return { ok: false, error: "runId must be a 0x bytes32" };
  }
  if (!Array.isArray(b.inputs)) return { ok: false, error: "inputs must be an array" };
  // Deep validation of each input happens authoritatively inside settle().
  return { ok: true, value: { runId: b.runId as Hex, inputs: b.inputs as Input[] } };
}

export interface SerializedSession {
  runId: string;
  seed: number;
  issuedAt: number;
}

export function serializeSession(s: SessionRecord): SerializedSession {
  return { runId: s.runId, seed: s.seed, issuedAt: s.issuedAt };
}

interface SerializedVoucher {
  player: string;
  runId: string;
  amount: string;
  deadline: string;
}

export type SerializedSettle =
  | {
      status: "accepted";
      score: number;
      ticks: number;
      foodEaten: number;
      died: boolean;
      amount: string;
      flagged: boolean;
      flags: string[];
      signer: string;
      signature: string;
      voucher: SerializedVoucher;
      txHash?: string;
    }
  | {
      status: "no_reward";
      reason: NoRewardReason;
      score: number;
      ticks: number;
      amount: string;
    }
  | { status: "rejected"; reason: RejectReason };

export function serializeSettle(res: SettleResult): SerializedSettle {
  switch (res.status) {
    case "accepted":
      return {
        status: "accepted",
        score: res.score,
        ticks: res.ticks,
        foodEaten: res.foodEaten,
        died: res.died,
        amount: res.amount.toString(),
        flagged: res.flagged,
        flags: res.flags,
        signer: res.signed.signer,
        signature: res.signed.signature,
        voucher: {
          player: res.signed.voucher.player,
          runId: res.signed.voucher.runId,
          amount: res.signed.voucher.amount.toString(),
          deadline: res.signed.voucher.deadline.toString(),
        },
        txHash: res.txHash,
      };
    case "no_reward":
      return {
        status: "no_reward",
        reason: res.reason,
        score: res.score,
        ticks: res.ticks,
        amount: res.amount.toString(),
      };
    case "rejected":
      return { status: "rejected", reason: res.reason };
  }
}

// HTTP status for each settle outcome.
export function settleHttpStatus(res: SettleResult): number {
  switch (res.status) {
    case "accepted":
      return 200;
    case "no_reward":
      return 200; // a valid run that simply earned nothing is not an error
    case "rejected":
      return res.reason === "unknown_session" ? 404 : 409;
  }
}
