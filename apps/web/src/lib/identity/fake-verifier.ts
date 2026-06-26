// fake-verifier.ts — a map-backed IdentityVerifier for tests and local dev. It
// records every player it is asked about (so a test can assert the verifier is
// NOT consulted for sub-bar runs), and supports the linked-wallet case by mapping
// several wallets to one root. With `selfRoot`, any unknown player is treated as
// its own verified root — the local-dev fallback so the reward loop runs without
// a live GoodDollar connection.
import type { Address } from "viem";
import type { IdentityCheck, IdentityVerifier } from "./verifier.ts";

export interface FakeVerifierOptions {
  /** Lowercased player address → lowercased GoodDollar root. */
  roots?: Record<string, string>;
  /** Treat any player absent from `roots` as its own verified root (dev only). */
  selfRoot?: boolean;
}

export function createFakeVerifier(
  opts: FakeVerifierOptions = {},
): IdentityVerifier & { calls: Address[] } {
  const roots = opts.roots ?? {};
  const calls: Address[] = [];
  return {
    calls,
    async check(player: Address): Promise<IdentityCheck> {
      calls.push(player);
      const key = player.toLowerCase();
      const mapped = roots[key];
      if (mapped) return { verified: true, root: mapped.toLowerCase() };
      if (opts.selfRoot) return { verified: true, root: key };
      return { verified: false, root: "" };
    },
  };
}
