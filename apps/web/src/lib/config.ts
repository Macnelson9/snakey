// config.ts — server-side configuration assembled from the environment, memoized
// per process. The store is chosen at boot: Upstash Redis when credentials are
// present (production / multi-instance), otherwise the in-memory store for local
// dev. Secrets required only by /settle (the scorer key, the rewards contract)
// are validated lazily so /session works without them in development.
import type { Address, Hex } from "viem";
import { G$ } from "./reward.ts";
import { createMemoryStore } from "./session/memory-store.ts";
import { createRedisStore } from "./session/redis-store.ts";
import type { SessionStore } from "./session/store.ts";
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

/** Assemble settle parameters; validates the secrets /settle needs. */
export function getSettleParams(): SettleParams {
  return {
    store: getStore(),
    scorerPrivateKey: required("SCORER_PRIVATE_KEY") as Hex,
    voucherContext: {
      chainId: num("CHAIN_ID", 44787), // Alfajores testnet by default
      verifyingContract: required("GAME_REWARDS_ADDRESS") as Address,
    },
    dailyCap: G$(num("DAILY_CAP_GD", 6)),
    minMsPerTick: num("MIN_MS_PER_TICK", 50),
    voucherTtlMs: num("VOUCHER_TTL_MS", 10 * 60_000),
  };
}
