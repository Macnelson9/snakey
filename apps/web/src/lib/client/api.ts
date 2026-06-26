// api.ts — typed browser client for the score-integrity backend. fetch is
// injectable so request shaping is unit-testable. The player address is a
// TEMP placeholder until sub-project B supplies a real Privy wallet.
import type { Address } from "viem";
import type { Input } from "@nokiadot/engine";

// TEMP: replaced by the Privy player address in sub-project B.
export const PLACEHOLDER_PLAYER = "0x000000000000000000000000000000000000dEaD" as Address;

export interface SessionResponse { runId: string; seed: number; issuedAt: number; }

interface SettleVoucher { player: string; runId: string; amount: string; deadline: string; }
export type SettleResponse =
  | { status: "accepted"; score: number; ticks: number; foodEaten: number; died: boolean; amount: string; flagged: boolean; flags: string[]; signer: string; signature: string; voucher: SettleVoucher }
  | { status: "no_reward"; reason: "below_bar" | "cap_reached" | "not_verified"; score: number; ticks: number; amount: string }
  | { status: "rejected"; reason: "invalid_input" | "unknown_session" | "replay" | "implausible_timing" };

type FetchImpl = typeof fetch;

export async function createSession(player: Address, fetchImpl: FetchImpl = fetch): Promise<SessionResponse> {
  const res = await fetchImpl("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // identity is required by the current /session contract and keys the daily
    // cap; with a placeholder player it is just the player address. Once the
    // GoodDollar identity gate merges, /session derives identity server-side and
    // ignores this field.
    body: JSON.stringify({ player, identity: player }),
  });
  if (!res.ok) throw new Error(`/api/session failed: ${res.status}`);
  return res.json() as Promise<SessionResponse>;
}

export async function submitRun(runId: string, inputs: Input[], fetchImpl: FetchImpl = fetch): Promise<SettleResponse> {
  // 200/404/409 all carry a settle body; rejected outcomes are not thrown.
  const res = await fetchImpl("/api/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, inputs }),
  });
  return res.json() as Promise<SettleResponse>;
}
