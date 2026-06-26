// verifier.ts — the GoodDollar identity gate's contract. The server NEVER trusts
// a client-supplied identity (CLAUDE.md: server is the only authority). Instead
// it derives the canonical verified-human identity from on-chain GoodDollar
// state, keyed on the player's wallet, and the per-identity daily cap is keyed on
// the returned `root`. Any implementation (on-chain, fake) that satisfies this
// interface is interchangeable — see onchain-verifier.ts and fake-verifier.ts.
import type { Address } from "viem";

export interface IdentityCheck {
  /** True when the player maps to a verified GoodDollar human. */
  verified: boolean;
  /**
   * Canonical GoodDollar root identity (lowercased 0x address) the daily cap is
   * keyed on. Multiple wallets linked to one face-verification share a root, so
   * they collapse to a single cap bucket. Empty string when unverified.
   */
  root: string;
}

export interface IdentityVerifier {
  /** Resolve the player's GoodDollar verification state and canonical root. */
  check(player: Address): Promise<IdentityCheck>;
}
