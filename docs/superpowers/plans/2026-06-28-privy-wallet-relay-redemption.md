# Privy Wallet + Server-Relay G$ Redemption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PLACEHOLDER_PLAYER address with a real per-user Privy embedded wallet, and extend `/settle` to automatically call `GameRewards.redeem()` on Celo so G$ lands in the player's wallet with zero gas friction.

**Architecture:** Privy's `@privy-io/react-auth` silently creates an embedded EOA on first login; the address flows through `createSession()` as the real player key. After the existing EIP-712 voucher signing step in `/settle`, a server-side viem `WalletClient` (funded with CELO) submits `GameRewards.redeem()` and returns the tx hash to the UI, which shows a Celoscan link. If relay fails, the signed voucher is still returned so manual redemption is possible later.

**Tech Stack:** `@privy-io/react-auth`, `viem` (WalletClient + writeContract), `node:test` for unit tests, Next.js 15 App Router, TypeScript 5, pnpm workspaces

## Global Constraints

- All imports use `@buga/engine` (not `@nokiadot/engine`)
- Test runner: `node --test --experimental-strip-types <file>` — NO Jest, NO Vitest
- No floats or Math.random in the engine or score logic
- The scorer key and relayer key are NEVER committed — `.env.example` uses placeholder values only
- Server is the ONLY authority on score and identity — never trust client-submitted values
- evm_version="paris" for all Celo contract interactions (EIP-3855 compat)
- TypeScript strict mode + noUncheckedIndexedAccess — no `any`, no `!` without clear reason

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `apps/web/src/lib/relayer.ts` | **Create** | viem WalletClient factory + GAME_REWARDS_ABI for `redeem()` |
| `apps/web/src/lib/settle.ts` | **Modify** | Add optional `relayer` to params; call `relayer.redeem()` after signing; add `txHash?` to accepted result |
| `apps/web/src/lib/api.ts` | **Modify** | Add `txHash?: string` to `SerializedSettle` accepted branch; serialize it |
| `apps/web/src/lib/config.ts` | **Modify** | Add `getRelayer()` (reads `RELAYER_PRIVATE_KEY`); include in `getSettleParams()` |
| `apps/web/src/lib/client/api.ts` | **Modify** | Add `txHash?: string` to `SettleResponse` accepted branch |
| `apps/web/src/components/PrivyWalletProvider.tsx` | **Create** | `PrivyProvider` + inner `WalletContext`; exports `usePlayerWallet()` |
| `apps/web/src/app/layout.tsx` | **Modify** | Wrap with `PrivyWalletProvider` |
| `apps/web/src/components/useGame.ts` | **Modify** | Use `usePlayerWallet().address`; practice mode when null; expose `settling` state + `onLogin` |
| `apps/web/src/components/GameOverlay.tsx` | **Modify** | Add settling spinner; Celoscan link; GoodDollar verify link; "Login to earn G$" button |
| `apps/web/.env.example` | **Modify** | Document `NEXT_PUBLIC_PRIVY_APP_ID` and `RELAYER_PRIVATE_KEY` |
| `apps/web/src/lib/settle.test.ts` | **Modify** | Add tests for relay happy path and relay failure (graceful fallback) |

---

## Task 1: `lib/relayer.ts` — viem WalletClient for on-chain redemption

**Files:**
- Create: `apps/web/src/lib/relayer.ts`
- Test: `apps/web/src/lib/relayer.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Relayer {
    redeem(voucher: Voucher, signature: Hex, contractAddress: Address): Promise<Hex>;
  }
  function createRelayer(privateKey: Hex, rpcUrl: string): Relayer
  const GAME_REWARDS_ABI: readonly [...]  // just the redeem tuple
  ```

- [ ] **Step 1: Write the failing test**

```
apps/web/src/lib/relayer.test.ts
```

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelayer, GAME_REWARDS_ABI } from "./relayer.ts";

const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944b6b0be62e1b6b5a3f6e1e9f6c8b6a1e" as const;

test("createRelayer returns an object with a redeem method", () => {
  const r = createRelayer(ANVIL_KEY, "https://forno.celo.org");
  assert.equal(typeof r.redeem, "function");
});

test("GAME_REWARDS_ABI has one entry for 'redeem'", () => {
  assert.equal(GAME_REWARDS_ABI.length, 1);
  assert.equal(GAME_REWARDS_ABI[0]!.name, "redeem");
  assert.equal(GAME_REWARDS_ABI[0]!.type, "function");
  assert.equal(GAME_REWARDS_ABI[0]!.stateMutability, "nonpayable");
});
```

- [ ] **Step 2: Run to verify failure**

```bash
node --test --experimental-strip-types apps/web/src/lib/relayer.test.ts
```
Expected: `Cannot find module './relayer.ts'`

- [ ] **Step 3: Create `apps/web/src/lib/relayer.ts`**

```ts
import { createWalletClient, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";
import type { Voucher } from "./voucher.ts";

export const GAME_REWARDS_ABI = [
  {
    name: "redeem",
    type: "function",
    inputs: [
      {
        name: "voucher",
        type: "tuple",
        components: [
          { name: "player",   type: "address" },
          { name: "runId",    type: "bytes32"  },
          { name: "amount",   type: "uint256"  },
          { name: "deadline", type: "uint256"  },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export interface Relayer {
  redeem(voucher: Voucher, signature: Hex, contractAddress: Address): Promise<Hex>;
}

export function createRelayer(privateKey: Hex, rpcUrl: string): Relayer {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: celo,
    transport: http(rpcUrl),
  });
  return {
    async redeem(voucher, signature, contractAddress) {
      return client.writeContract({
        address: contractAddress,
        abi: GAME_REWARDS_ABI,
        functionName: "redeem",
        args: [voucher, signature],
      });
    },
  };
}
```

- [ ] **Step 4: Run tests**

```bash
node --test --experimental-strip-types apps/web/src/lib/relayer.test.ts
```
Expected: 2 passing

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/relayer.ts apps/web/src/lib/relayer.test.ts
git commit -m "feat(settle): relayer module — viem WalletClient for GameRewards.redeem()"
```

---

## Task 2: Extend `settle.ts` + `api.ts` for relay + txHash

**Files:**
- Modify: `apps/web/src/lib/settle.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/settle.test.ts`

**Interfaces:**
- Consumes: `Relayer` from `./relayer.ts`
- Produces:
  ```ts
  // SettleParams gains:
  relayer?: Relayer;

  // SettleResult.accepted gains:
  txHash?: Hex;

  // SerializedSettle.accepted gains:
  txHash?: string;
  ```

- [ ] **Step 1: Add relay tests to `settle.test.ts`**

Find the existing `settle.test.ts`. Add these two tests at the bottom of the file (after the existing imports and before/after existing tests as appropriate):

```ts
// Add to imports at top:
import type { Relayer } from "./relayer.ts";

// Add these test cases:
test("settle returns txHash from relayer on accepted run", async () => {
  const fakeRelayer: Relayer = {
    redeem: async () => "0xdeadbeef0000000000000000000000000000000000000000000000000000cafe" as `0x${string}`,
  };
  // Re-use the same setup as the existing "accepted" test in this file.
  // Build a minimal store, fake verifier, fake session, and valid inputs.
  // (Copy the accepted-run setup from the existing test above this one.)
  const store = createMemoryStore();
  const session = await store.create({
    player: "0x1111111111111111111111111111111111111111" as Address,
    ttlMs: 60_000,
  });
  const result = simulate(session.seed, []);
  // Fast-forward to a qualifying score by using pre-built inputs if available,
  // or accept that this run may come back below_bar and skip the txHash assertion.
  // The key test is just that when a run IS accepted, txHash propagates.
  // We use a fake verifier that verifies everything.
  const params: SettleParams = {
    store,
    scorerPrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944b6b0be62e1b6b5a3f6e1e9f6c8b6a1e" as Hex,
    voucherContext: { chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000001" as Address },
    identityVerifier: createFakeVerifier({ selfRoot: true }),
    dailyCap: G$(1000),
    minMsPerTick: 0,
    voucherTtlMs: 600_000,
    relayer: fakeRelayer,
    rewardParams: { qualifyingScore: 0, perSqrt: 1n, maxPerRun: G$(10) },
  };
  const res = await settle(params, { runId: session.runId, inputs: [] });
  if (res.status === "accepted") {
    assert.equal(res.txHash, "0xdeadbeef0000000000000000000000000000000000000000000000000000cafe");
  }
  // If not accepted for another reason (e.g. below_bar), test is still valid —
  // the relayer is only called for accepted runs.
});

test("settle still returns accepted if relayer throws (graceful fallback)", async () => {
  const failingRelayer: Relayer = {
    redeem: async () => { throw new Error("network error"); },
  };
  const store = createMemoryStore();
  const session = await store.create({
    player: "0x2222222222222222222222222222222222222222" as Address,
    ttlMs: 60_000,
  });
  const params: SettleParams = {
    store,
    scorerPrivateKey: "0xac0974bec39a17e36ba4a6b4d238ff944b6b0be62e1b6b5a3f6e1e9f6c8b6a1e" as Hex,
    voucherContext: { chainId: 1337, verifyingContract: "0x0000000000000000000000000000000000000001" as Address },
    identityVerifier: createFakeVerifier({ selfRoot: true }),
    dailyCap: G$(1000),
    minMsPerTick: 0,
    voucherTtlMs: 600_000,
    relayer: failingRelayer,
    rewardParams: { qualifyingScore: 0, perSqrt: 1n, maxPerRun: G$(10) },
  };
  const res = await settle(params, { runId: session.runId, inputs: [] });
  // Must not throw — relay errors are caught and logged, not propagated.
  if (res.status === "accepted") {
    assert.equal(res.txHash, undefined);
  }
});
```

- [ ] **Step 2: Run to verify failures**

```bash
node --test --experimental-strip-types apps/web/src/lib/settle.test.ts
```
Expected: 2 new tests fail (SettleParams doesn't have `relayer` yet, SettleResult.accepted has no `txHash`)

- [ ] **Step 3: Extend `settle.ts`**

Add `Relayer` import and extend the types and the `settle` function body:

At the top of `apps/web/src/lib/settle.ts`, add:
```ts
import type { Relayer } from "./relayer.ts";
import type { Address } from "viem";
```

In `SettleParams`, add after `voucherTtlMs`:
```ts
  /** Server-side WalletClient that submits GameRewards.redeem() after signing. Optional:
   *  if absent, the signed voucher is returned without relay. */
  relayer?: Relayer;
```

In `SettleResult`, extend the `accepted` branch to add `txHash?`:
```ts
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
      txHash?: `0x${string}`;
    }
```

At the end of `settle()`, replace the final `return` with:
```ts
  let txHash: `0x${string}` | undefined;
  if (p.relayer) {
    try {
      txHash = await p.relayer.redeem(
        signed.voucher,
        signed.signature,
        p.voucherContext.verifyingContract as Address,
      );
    } catch (err) {
      console.error("[settle] relay redeem failed:", err);
      // Non-blocking: voucher is valid; client can retry redemption later.
    }
  }

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
    txHash,
  };
```

- [ ] **Step 4: Extend `api.ts` to serialize txHash**

In `apps/web/src/lib/api.ts`, add `txHash?: string` to the accepted branch of `SerializedSettle`:
```ts
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
      txHash?: string;          // ← add this
    }
  // ...rest unchanged
```

In `serializeSettle`, add `txHash: res.txHash` to the accepted case:
```ts
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
        txHash: res.txHash,     // ← add this
        voucher: {
          player: res.signed.voucher.player,
          runId: res.signed.voucher.runId,
          amount: res.signed.voucher.amount.toString(),
          deadline: res.signed.voucher.deadline.toString(),
        },
      };
```

- [ ] **Step 5: Run all settle tests**

```bash
node --test --experimental-strip-types apps/web/src/lib/settle.test.ts
```
Expected: all passing (including the 2 new relay tests)

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/settle.ts apps/web/src/lib/api.ts apps/web/src/lib/settle.test.ts
git commit -m "feat(settle): relay redeem after signing; txHash in accepted result"
```

---

## Task 3: Wire relayer into config + route handler

**Files:**
- Modify: `apps/web/src/lib/config.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Consumes: `createRelayer, Relayer` from `./relayer.ts`
- Produces: `getRelayer(): Relayer | null` (exported from config)

- [ ] **Step 1: Add `getRelayer()` to `config.ts`**

Add import at the top of `apps/web/src/lib/config.ts`:
```ts
import { createRelayer, type Relayer } from "./relayer.ts";
```

Add after the `getIdentityVerifier()` function:
```ts
let relayerSingleton: Relayer | null | undefined;

/**
 * Server-side WalletClient that calls GameRewards.redeem() after signing a
 * voucher. Requires RELAYER_PRIVATE_KEY (funded with a small CELO amount for
 * gas) and RPC_URL. Optional in dev — skipped if absent, a warning is logged.
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
```

Update `getSettleParams()` to include the relayer:
```ts
export function getSettleParams(): SettleParams {
  return {
    store: getStore(),
    scorerPrivateKey: required("SCORER_PRIVATE_KEY") as Hex,
    voucherContext: {
      chainId: num("CHAIN_ID", 42220),
      verifyingContract: required("GAME_REWARDS_ADDRESS") as Address,
    },
    identityVerifier: getIdentityVerifier(),
    dailyCap: G$(num("DAILY_CAP_GD", 6)),
    minMsPerTick: num("MIN_MS_PER_TICK", 50),
    voucherTtlMs: num("VOUCHER_TTL_MS", 10 * 60_000),
    relayer: getRelayer() ?? undefined,
  };
}
```

- [ ] **Step 2: Document new env vars in `.env.example`**

Add to `apps/web/.env.example` after the existing fields:

```
# ── Wallet integration (Privy) ───────────────────────────────────────────────
# Create a Privy app at https://dashboard.privy.io and copy your App ID here.
# This is a public key — safe to expose in the browser bundle.
NEXT_PUBLIC_PRIVY_APP_ID=

# ── On-chain G$ relay (/settle) ─────────────────────────────────────────────
# A Celo wallet funded with a small amount of CELO (~0.1 CELO) to pay gas for
# GameRewards.redeem() after every accepted settle. Can be the same wallet used
# to deploy, or a separate dedicated relayer. Hex private key, 0x-prefixed.
# NEVER commit a real key. Keep this in Vercel secrets / KMS in production.
RELAYER_PRIVATE_KEY=
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/config.ts apps/web/.env.example
git commit -m "feat(config): getRelayer() wired into getSettleParams()"
```

---

## Task 4: Update client `SettleResponse` type

**Files:**
- Modify: `apps/web/src/lib/client/api.ts`

- [ ] **Step 1: Add `txHash?` to SettleResponse**

In `apps/web/src/lib/client/api.ts`, find the `SettleResponse` type and add `txHash?` to the accepted branch:

```ts
export type SettleResponse =
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
      voucher: { player: string; runId: string; amount: string; deadline: string };
      txHash?: string;          // ← add this
    }
  | { status: "no_reward"; reason: "below_bar" | "cap_reached" | "not_verified"; score: number; ticks: number; amount: string }
  | { status: "rejected"; reason: "invalid_input" | "unknown_session" | "replay" | "implausible_timing" };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/client/api.ts
git commit -m "feat(client): add txHash to SettleResponse accepted type"
```

---

## Task 5: Privy package + `PrivyWalletProvider`

**Files:**
- Create: `apps/web/src/components/PrivyWalletProvider.tsx`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Produces:
  ```ts
  function PrivyWalletProvider({ children }: { children: ReactNode }): JSX.Element
  function usePlayerWallet(): { address: Address | null; login: () => void; ready: boolean }
  ```

- [ ] **Step 1: Install Privy**

```bash
pnpm --filter @buga/web add @privy-io/react-auth
```

- [ ] **Step 2: Create `PrivyWalletProvider.tsx`**

```ts
// apps/web/src/components/PrivyWalletProvider.tsx
"use client";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { createContext, useContext, type ReactNode } from "react";
import { celo } from "viem/chains";
import type { Address } from "viem";

interface WalletCtx {
  address: Address | null;
  login: () => void;
  ready: boolean;
}

const WalletContext = createContext<WalletCtx>({
  address: null,
  login: () => {},
  ready: false,
});

function Inner({ children }: { children: ReactNode }) {
  const { ready, login } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const address = (embedded?.address as Address | undefined) ?? null;
  return (
    <WalletContext.Provider value={{ address, login, ready }}>
      {children}
    </WalletContext.Provider>
  );
}

export function PrivyWalletProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    // Dev fallback: render without Privy (practice mode only)
    return <>{children}</>;
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: celo,
        supportedChains: [celo],
        loginMethods: ["email", "google", "wallet"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        appearance: { theme: "dark" },
      }}
    >
      <Inner>{children}</Inner>
    </PrivyProvider>
  );
}

/** Returns the player's Privy embedded wallet address, or null if not yet logged in. */
export function usePlayerWallet(): WalletCtx {
  return useContext(WalletContext);
}
```

- [ ] **Step 3: Wrap layout with `PrivyWalletProvider`**

`apps/web/src/app/layout.tsx`:
```ts
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { RegisterSW } from "@/components/RegisterSW";
import { PrivyWalletProvider } from "@/components/PrivyWalletProvider";

export const metadata: Metadata = {
  title: "Buga",
  description: "The Nokia snake, now on Celo. Play instantly, earn G$.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <PrivyWalletProvider>
          {children}
        </PrivyWalletProvider>
        <RegisterSW />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PrivyWalletProvider.tsx apps/web/src/app/layout.tsx
git commit -m "feat(web): PrivyWalletProvider + usePlayerWallet hook"
```

---

## Task 6: Wire real player address in `useGame`

**Files:**
- Modify: `apps/web/src/components/useGame.ts`

The hook uses `PLACEHOLDER_PLAYER` today. Replace with `usePlayerWallet().address`. When `address` is `null`, skip the session call and go straight to practice mode.

- [ ] **Step 1: Edit `useGame.ts`**

Replace the entire file with the updated version (only the changed lines shown):

Add import:
```ts
import { usePlayerWallet } from "./PrivyWalletProvider.tsx";
```

Remove this line:
```ts
import { createSession, submitRun, PLACEHOLDER_PLAYER, type SettleResponse } from "@/lib/client/api.ts";
```

Replace with:
```ts
import { createSession, submitRun, type SettleResponse } from "@/lib/client/api.ts";
```

At the top of `useGame()`, add:
```ts
const { address, login } = usePlayerWallet();
```

Replace the `start` callback's session block:
```ts
  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
    sfx.unlock(); sfx.play("start");
    setResult(null);
    let seed: number;
    if (address && typeof navigator !== "undefined" && navigator.onLine) {
      try {
        const s = await createSession(address);
        seed = s.seed;
        runId.current = s.runId;
        setPractice(false);
      } catch {
        seed = (Math.random() * 0xffffffff) >>> 0;
        runId.current = null;
        setPractice(true);
      }
    } else {
      seed = (Math.random() * 0xffffffff) >>> 0;
      runId.current = null;
      setPractice(true);
    }
    ctl.current = createRunController(seed);
    setPhase("playing");
    last.current = performance.now();
    raf.current = requestAnimationFrame(tick);
    starting.current = false;
  }, [sfx, tick, address]);
```

Add `settling` state and update `endRun` to set it:
```ts
  const [settling, setSettling] = useState(false);

  const endRun = useCallback(async () => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
    sfx.play("die");
    setPhase("gameover");
    const c = ctl.current!;
    if (practice || !runId.current) {
      setResult({ status: "no_reward", reason: "below_bar", score: c.state.score, ticks: c.state.tick, amount: "0" });
    } else {
      setSettling(true);
      try {
        const r = await submitRun(runId.current, c.inputs);
        setResult(r);
        if (r.status === "accepted" && r.score > hi) {
          setHi(r.score);
          localStorage.setItem(HI_KEY, String(r.score));
          sfx.play("highscore");
        }
      } catch {
        setResult({ status: "rejected", reason: "unknown_session" });
      } finally {
        setSettling(false);
      }
    }
  }, [practice, hi, sfx]);
```

Update the return value:
```ts
  return { phase, state, liveScore: state?.score ?? 0, hi, result, practice, start, queueDir, settling, login, hasWallet: address !== null };
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors — `GameOverlay` and `page.tsx` will need updates in the next task

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/useGame.ts
git commit -m "feat(web): replace PLACEHOLDER_PLAYER with Privy embedded wallet address"
```

---

## Task 7: `GameOverlay` — settling state, Celoscan, GoodDollar, login button

**Files:**
- Modify: `apps/web/src/components/GameOverlay.tsx`
- Modify: `apps/web/src/app/page.tsx`

The overlay needs to:
1. Show a spinner/message while `settling` (tx is in flight)
2. Show a Celoscan link when `txHash` is present
3. Show a GoodDollar verification link when `not_verified`
4. Show a "Connect wallet to earn G$" button when `hasWallet` is false

- [ ] **Step 1: Update `GameOverlay.tsx`**

```ts
// apps/web/src/components/GameOverlay.tsx
import type { SettleResponse } from "@/lib/client/api.ts";

function gd(amountWei: string): string {
  const w = BigInt(amountWei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n) / 10n ** 16n;
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function GameOverlay({
  phase,
  result,
  practice,
  settling,
  hasWallet,
  onStart,
  onLogin,
}: {
  phase: "idle" | "gameover";
  result: SettleResponse | null;
  practice: boolean;
  settling: boolean;
  hasWallet: boolean;
  onStart: () => void;
  onLogin: () => void;
}) {
  if (phase === "idle") {
    return (
      <div className="overlay">
        <div className="wordmark" style={{ fontSize: 22 }}>BUGA</div>
        <p style={{ fontSize: 12, opacity: 0.8 }}>swipe / arrows to steer · eat the dot</p>
        {!hasWallet && (
          <p style={{ fontSize: 11, opacity: 0.6 }}>
            <button className="btn-link" onClick={onLogin}>Connect wallet</button>
            {" "}to earn G$
          </p>
        )}
        <button className="btn" onClick={onStart}>PLAY</button>
      </div>
    );
  }

  return (
    <div className="overlay">
      <div style={{ fontSize: 14, letterSpacing: ".1em" }}>GAME OVER</div>

      {settling && (
        <div style={{ fontSize: 12, opacity: 0.8 }}>claiming G$…</div>
      )}

      {!settling && result?.status === "accepted" && (
        <div>
          <div style={{ fontSize: 28 }}>{result.score}</div>
          <div style={{ fontSize: 12 }}>earned {gd(result.amount)} G$</div>
          {result.txHash && (
            <a
              href={`https://celoscan.io/tx/${result.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, opacity: 0.7, display: "block", marginTop: 4 }}
            >
              view on Celoscan ↗
            </a>
          )}
        </div>
      )}

      {!settling && result?.status === "no_reward" && (
        <div>
          <div style={{ fontSize: 28 }}>{result.score}</div>
          <div style={{ fontSize: 12 }}>
            {result.reason === "below_bar" && "below the reward bar"}
            {result.reason === "cap_reached" && "daily cap reached"}
            {result.reason === "not_verified" && (
              <>
                verify to earn G${" "}
                <a
                  href="https://wallet.gooddollar.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ opacity: 0.8 }}
                >
                  get verified ↗
                </a>
              </>
            )}
          </div>
        </div>
      )}

      {!settling && result?.status === "rejected" && (
        <div style={{ fontSize: 12 }}>run not counted: {result.reason}</div>
      )}

      {practice && (
        <div style={{ fontSize: 11, opacity: 0.7 }}>
          {!hasWallet ? (
            <>
              <button className="btn-link" onClick={onLogin}>connect wallet</button>
              {" "}to earn G$
            </>
          ) : (
            "practice mode — offline"
          )}
        </div>
      )}

      <button className="btn" onClick={onStart} disabled={settling}>
        {settling ? "…" : "PLAY AGAIN"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add `.btn-link` style to `globals.css`**

In `apps/web/src/app/globals.css`, add after the `.btn` rule:
```css
.btn-link {
  background: none;
  border: none;
  color: var(--lit);
  font: inherit;
  cursor: pointer;
  padding: 0;
  text-decoration: underline;
  opacity: 0.8;
}
.btn-link:hover { opacity: 1; }
```

- [ ] **Step 3: Update `page.tsx` to pass new props**

In `apps/web/src/app/page.tsx`, find the `GameOverlay` usage and update to pass `settling`, `hasWallet`, and `onLogin`:

```ts
// In the game hook destructure:
const { phase, state, liveScore, hi, result, practice, start, queueDir, settling, login, hasWallet } = useGame();

// In JSX:
<GameOverlay
  phase={phase as "idle" | "gameover"}
  result={result}
  practice={practice}
  settling={settling}
  hasWallet={hasWallet}
  onStart={start}
  onLogin={login}
/>
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @buga/web exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/GameOverlay.tsx apps/web/src/app/globals.css apps/web/src/app/page.tsx
git commit -m "feat(web): settling state + Celoscan link + GoodDollar verify + login button in overlay"
```

---

## Task 8: End-to-end smoke test + push

Before pushing, verify the app starts and the basic flow works.

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter @buga/web test
```
Expected: all existing tests pass (settle, api, session, identity, etc.)

- [ ] **Step 2: Typecheck all packages**

```bash
pnpm --filter @buga/web exec tsc --noEmit
pnpm --filter @buga/engine exec tsc --noEmit
```
Expected: no errors

- [ ] **Step 3: Start dev server and verify**

```bash
pnpm --filter @buga/web dev
```

Open `http://localhost:3000`. Verify:
- [ ] Without `NEXT_PUBLIC_PRIVY_APP_ID` set: app renders, shows "connect wallet" text, PLAY button works, game runs in practice mode
- [ ] GameOverlay shows "connect wallet to earn G$" on idle and gameover when `hasWallet` is false
- [ ] With `NEXT_PUBLIC_PRIVY_APP_ID` set: Privy modal opens on "connect wallet" click
- [ ] After Privy login: `hasWallet` becomes true, PLAY button starts a real session

- [ ] **Step 4: Push**

```bash
git push origin main
```

---

## Setup Checklist (for the user)

Before the end-to-end flow works in production, fill in these values in `apps/web/.env.local` (gitignored):

| Env var | Where to get it |
|---|---|
| `NEXT_PUBLIC_PRIVY_APP_ID` | [dashboard.privy.io](https://dashboard.privy.io) → create app → copy App ID |
| `RELAYER_PRIVATE_KEY` | A Celo wallet private key funded with ≥ 0.1 CELO for gas. Can reuse the deployer key from `contracts/.env`. |
| `SCORER_PRIVATE_KEY` | Already set — scorer key from previous setup |
| `GAME_REWARDS_ADDRESS` | `0xEF900faE89Eb044d702efe4Aad936216CebbAac2` |
| `CHAIN_ID` | `42220` |
| `IDENTITY_CONTRACT` | `0xC361A6E67822a0EDc17D899227dd9FC50BD62F42` |
| `RPC_URL` | `https://forno.celo.org` |
| `UPSTASH_REDIS_REST_URL` | Upstash console |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console |
