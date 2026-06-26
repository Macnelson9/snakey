// store.ts — the stateful layer around the stateless verifier. It issues
// seed-bound, single-use, time-boxed, identity-bound sessions (closing seed
// precomputation, CLAUDE.md settle flow step 1) and tracks per-identity daily
// payout totals for the hard daily cap. Any backend (in-memory, Redis, Postgres)
// that satisfies this interface is interchangeable — see store-contract.ts.
import type { Address, Hex } from "viem";

export interface SessionRecord {
  /** 32-byte run id, also the EIP-712 voucher runId and on-chain replay key. */
  runId: Hex;
  /** uint32 CSPRNG seed handed to the deterministic engine. */
  seed: number;
  /** Payout wallet that will redeem the voucher. */
  player: Address;
  /** GoodDollar identity the session (and daily cap) is bound to. */
  identity: string;
  /** Server wall-clock ms at issuance — the only trusted time source. */
  issuedAt: number;
  /** True once settled; sessions are single-use. */
  used: boolean;
}

export interface CreateSessionInput {
  player: Address;
  identity: string;
  /** Lifetime in ms; the session cannot be settled after it elapses. */
  ttlMs: number;
}

export interface SessionStore {
  /** Issue a new session with a fresh CSPRNG seed and runId. */
  create(input: CreateSessionInput): Promise<SessionRecord>;

  /** Fetch a live session, or null if missing or expired. */
  get(runId: string): Promise<SessionRecord | null>;

  /**
   * Atomically mark a session used. Returns true exactly once (the settling
   * call), false on replay or unknown/expired runId. This is the server-side
   * single-use guard, distinct from the on-chain consumed[runId] guard.
   */
  consume(runId: string): Promise<boolean>;

  /** Total G$ wei already paid to an identity on a given UTC day key (YYYY-MM-DD). */
  getDailyTotal(identity: string, dayKey: string): Promise<bigint>;

  /** Add to an identity's daily total; returns the new total. */
  addDailyTotal(identity: string, dayKey: string, amount: bigint): Promise<bigint>;
}
