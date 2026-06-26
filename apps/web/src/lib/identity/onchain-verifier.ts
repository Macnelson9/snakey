// onchain-verifier.ts — the production IdentityVerifier. It reads the live
// GoodDollar Identity contract's `getWhitelistedRoot(account)`, which returns the
// root verified-human address an account maps to (the account itself if it
// face-verified directly, or the root it is linked to), or the zero address if it
// maps to no verified human. Non-zero ⇒ verified, and that root is what the daily
// cap is keyed on. Whitelist expiry is intentionally not re-checked here (a
// non-zero root counts as verified) — see the design spec.
//
// It takes a viem Transport (not a prebuilt client) and owns the PublicClient
// internally: the transport boundary keeps the contract simple and lets tests
// inject a `custom` transport to run offline.
import {
  createPublicClient,
  zeroAddress,
  type Address,
  type Chain,
  type Transport,
} from "viem";
import { celo } from "viem/chains";
import type { IdentityCheck, IdentityVerifier } from "./verifier.ts";

const IDENTITY_ABI = [
  {
    type: "function",
    name: "getWhitelistedRoot",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export interface OnchainVerifierOptions {
  /** viem transport to the identity chain (e.g. http(rpcUrl), or custom in tests). */
  transport: Transport;
  /** GoodDollar Identity contract address (confirm against GoodDollar docs). */
  contract: Address;
  /** Defaults to Celo mainnet, where GoodDollar identity lives. */
  chain?: Chain;
}

export function createOnchainVerifier(opts: OnchainVerifierOptions): IdentityVerifier {
  const client = createPublicClient({ chain: opts.chain ?? celo, transport: opts.transport });
  return {
    async check(player: Address): Promise<IdentityCheck> {
      const root = await client.readContract({
        address: opts.contract,
        abi: IDENTITY_ABI,
        functionName: "getWhitelistedRoot",
        args: [player],
      });
      if (!root || root.toLowerCase() === zeroAddress) {
        return { verified: false, root: "" };
      }
      return { verified: true, root: root.toLowerCase() };
    },
  };
}
