// config.ts — server-side configuration assembled from the environment, memoized
// per process. The store is chosen at boot: Upstash Redis when credentials are
// present (production / multi-instance), otherwise the in-memory store for local
// dev. Secrets required only by /settle (the scorer key, the rewards contract)
// are validated lazily so /session works without them in development.
import { http, type Address, type Hex } from "viem";
import { createRelayer, type Relayer } from "./relayer.ts";
import { G$ } from "./reward.ts";
import { createMemoryStore } from "./session/memory-store.ts";
import { createRedisStore } from "./session/redis-store.ts";
import type { SessionStore } from "./session/store.ts";
import { createOnchainVerifier } from "./identity/onchain-verifier.ts";
import { createFakeVerifier } from "./identity/fake-verifier.ts";
import type { IdentityVerifier } from "./identity/verifier.ts";
import type { SettleParams } from "./settle.ts";

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${v}`);
  return n;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env ${name}`);
  return v;
}

let storeSingleton: SessionStore | undefined;

export function getStore(): SessionStore {
  if (storeSingleton) return storeSingleton;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    storeSingleton = createRedisStore({ url, token });
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("UPSTASH_REDIS_REST_URL/TOKEN are required in production");
    }
    console.warn("[config] No Upstash credentials — using in-memory store (dev only, not shared across instances).");
    storeSingleton = createMemoryStore();
  }
  return storeSingleton;
}

/** Session lifetime in ms (how long a player has to play and settle a run). */
export function getSessionTtlMs(): number {
  return num("SESSION_TTL_MS", 30 * 60_000);
}

let verifierSingleton: IdentityVerifier | undefined;

/**
 * The GoodDollar identity gate. Reads the live Identity contract when configured
 * (IDENTITY_CONTRACT + RPC_URL); otherwise falls back — in dev only — to a fake
 * that treats each player as its own root, so the reward loop runs locally
 * without GoodDollar. Production requires the real verifier.
 */
export function getIdentityVerifier(): IdentityVerifier {
  if (verifierSingleton) return verifierSingleton;
  const contract = process.env.IDENTITY_CONTRACT;
  const rpcUrl = process.env.RPC_URL;
  if (contract && rpcUrl) {
    verifierSingleton = createOnchainVerifier({
      transport: http(rpcUrl),
      contract: contract as Address,
    });
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error("IDENTITY_CONTRACT and RPC_URL are required in production");
    }
    console.warn("[config] No IDENTITY_CONTRACT/RPC_URL — using a self-root fake verifier (dev only, no sybil resistance).");
    verifierSingleton = createFakeVerifier({ selfRoot: true });
  }
  return verifierSingleton;
}

let relayerSingleton: Relayer | null | undefined;

/**
 * Server-side WalletClient that calls GameRewards.redeem() after signing a voucher.
 * Requires RELAYER_PRIVATE_KEY + RPC_URL. Optional in dev — skipped when absent.
 */
export function getRelayer(): Relayer | null {
  if (relayerSingleton !== undefined) return relayerSingleton;
  const pk = process.env.RELAYER_PRIVATE_KEY;
  const rpcUrl = process.env.RPC_URL;
  if (pk && rpcUrl) {
    relayerSingleton = createRelayer(pk as Hex, rpcUrl);
    return relayerSingleton;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("RELAYER_PRIVATE_KEY and RPC_URL are required in production");
  }
  console.warn("[config] No RELAYER_PRIVATE_KEY — settle will sign vouchers but skip on-chain relay.");
  relayerSingleton = null;
  return null;
}

/** Assemble settle parameters; validates the secrets /settle needs. */
export function getSettleParams(): SettleParams {
  return {
    store: getStore(),
    scorerPrivateKey: required("SCORER_PRIVATE_KEY") as Hex,
    voucherContext: {
      chainId: num("CHAIN_ID", 42220), // Celo mainnet (real G$) by default
      verifyingContract: required("GAME_REWARDS_ADDRESS") as Address,
    },
    identityVerifier: getIdentityVerifier(),
    dailyCap: G$(num("DAILY_CAP_GD", 6)),
    minMsPerTick: num("MIN_MS_PER_TICK", 50),
    voucherTtlMs: num("VOUCHER_TTL_MS", 10 * 60_000),
    relayer: getRelayer() ?? undefined,
  };
}
