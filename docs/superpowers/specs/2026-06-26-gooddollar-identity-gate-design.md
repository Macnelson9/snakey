# GoodDollar Identity Gate — Design Spec

> Milestone #3 (server half) from `claude.md`: gate G$ payouts behind on-chain
> GoodDollar identity. The Privy client wallet flow (guest → smart wallet →
> withdraw UI) is the deferred second half of this milestone and is **out of
> scope** here — it is blocked on the Privy App ID and overlaps the milestone #4
> PWA shell.

## Problem

`/session` currently accepts a client-supplied `identity` string, and the
per-identity daily cap is keyed on it. A bot sends a fresh random `identity` per
run, so the cap — the project's core sybil-resistance mechanism — is
meaningless. CLAUDE.md is explicit: **the server is the only authority, and must
never trust a client-submitted value.** The identity is no exception.

This spec makes the server derive the canonical identity from on-chain
GoodDollar state, keyed on the player's wallet, checked **before payout, never
before play** (CLAUDE.md core decision #4).

## Decisions (locked in brainstorming)

- **Both identity and rewards on Celo mainnet (chain 42220), real G$.** The
  verifier reads the live GoodDollar Identity contract. `CHAIN_ID` default
  becomes `42220`.
- **Server gate now; Privy client deferred.**
- **Verifier behind an interface** with an injectable fake (a test/dev seam,
  independent of the network choice).

## What "verified" means

GoodDollar's Identity contract exposes `getWhitelistedRoot(address)`, which
returns the **root** verified-human address that an account maps to — the
account itself if it face-verified directly, or the root it is linked to — and
`address(0)` if the account maps to no verified human. A non-zero root means
verified; that root is the canonical identity.

Keying the daily cap on the **root** (not the wallet, and certainly not a
client string) is the whole point: one human who face-verifies once and plays
from five linked wallets collapses to a single cap bucket. That linkage is the
sybil resistance GoodDollar provides.

Whitelist **expiry** re-checking is explicitly out of scope (YAGNI for the
demo): a non-zero root counts as verified. Noted as a future refinement.

## New module: `apps/web/src/lib/identity/`

```
verifier.ts          IdentityVerifier interface + IdentityCheck type
onchain-verifier.ts  viem publicClient → Identity.getWhitelistedRoot(player)
fake-verifier.ts     map-backed verifier for tests and local dev
verifier.test.ts     unit tests (fake + onchain against a mocked transport)
```

Interface:

```ts
export interface IdentityCheck {
  /** True when the player maps to a verified GoodDollar human. */
  verified: boolean;
  /**
   * Canonical GoodDollar root identity (lowercased 0x address) the daily cap is
   * keyed on. Empty string when unverified.
   */
  root: string;
}

export interface IdentityVerifier {
  check(player: Address): Promise<IdentityCheck>;
}
```

- **OnchainVerifier** — built from a viem `PublicClient` (or `{ chainId, rpcUrl }`)
  plus the `IDENTITY_CONTRACT` address. Calls `getWhitelistedRoot(player)` with a
  minimal inline ABI. Returns `{ verified: false, root: "" }` for the zero
  address, else `{ verified: true, root: returned.toLowerCase() }`. The transport
  is injectable so the unit test runs offline.
- **FakeVerifier** — constructed with a `Map<addressLower, rootLower>`. Any
  player in the map is verified with that root (supports the linked-wallet test:
  two wallets → same root). Absent players are unverified. Also the local-dev
  fallback, where it treats each player as its own root so the loop works
  without GoodDollar.

The GoodDollar Identity contract address is **not hardcoded** — it comes from
`IDENTITY_CONTRACT` and must be confirmed against GoodDollar docs at deploy.

## Settle reorder (security-critical, TDD'd)

Two opposite requirements drive the ordering:

- **An unverified run must NOT burn the session.** The player taps "claim",
  *then* is told to face-verify; the run must survive so they can verify and
  re-submit it. ⇒ identity check happens **before** `consume`.
- **An implausibly-fast run MUST burn the session.** `elapsed <
  ticks·minMsPerTick` only becomes *more* plausible as wall-clock passes, so a
  un-consumed implausible run could be replayed later once enough time elapses.
  ⇒ the timing check happens **after** `consume`.

New order in `settle()`:

1. `validInputs` → `rejected: invalid_input`
2. `store.get(runId)` → `rejected: unknown_session`
3. `simulate(seed, inputs)` → score, ticks, flags
4. `rewardForScore(score)`; if `0n` → `no_reward: below_bar` (**no consume** —
   re-submitting a deterministic sub-bar run is harmless, and we skip the RPC)
5. `identityVerifier.check(session.player)`; if `!verified` →
   **`no_reward: not_verified`** (**no consume** — the run survives for retry)
6. `store.consume(runId)`; if `false` → `rejected: replay`
7. timing: `elapsed < ticks·minMsPerTick` → `rejected: implausible_timing`
   (session already burned ✓)
8. cap on **root**: `remaining = dailyCap − getDailyTotal(root, day)`; if
   `<= 0n` → `no_reward: cap_reached`
9. `amount = min(reward, remaining)`; `addDailyTotal(root, amount)`; sign EIP-712
   voucher → `accepted`

The identity RPC fires only for above-bar runs (step 4 gates step 5). An
unverified caller can re-hit settle (each costs one `getWhitelistedRoot` read);
that is a rate-limit concern, deferred and noted, not a correctness one.

New result variant on `SettleResult`:

```ts
export type NoRewardReason = "below_bar" | "cap_reached" | "not_verified";
```

`not_verified` serializes like the other `no_reward` outcomes and returns HTTP
`200` (a valid run that simply has not been verified yet is not an error). The
client uses it as the trigger to launch GoodDollar face verification, then
re-submits the same `(runId, inputs)`.

## Ripple: drop the client identity

`identity` leaves the client-facing surface entirely.

- **`store.ts`** — remove `identity` from `SessionRecord` and
  `CreateSessionInput`. The daily-cap methods stay `string`-keyed
  (`getDailyTotal`/`addDailyTotal`), now fed the **root** at the call site.
- **`memory-store.ts`, `redis-store.ts`** — stop storing/serializing `identity`.
- **`store-contract.ts`** — drop `identity` from the `create` calls; daily-cap
  tests pass an arbitrary key (unchanged behavior).
- **`settle.ts`** — add `identityVerifier: IdentityVerifier` to `SettleParams`;
  apply the reorder; key the cap on `root`.
- **`api.ts`** — `parseSessionBody` accepts `player` only; drop `identity` from
  `SessionBody`. `SerializedSettle` / `serializeSettle` / `settleHttpStatus`
  gain the `not_verified` reason (still `no_reward`, still `200`).
- **`config.ts`** — construct the verifier; add `IDENTITY_CONTRACT` and
  `RPC_URL`; `CHAIN_ID` default → `42220`. Production throws if the verifier is
  not configured; dev falls back to the player-is-own-root `FakeVerifier`
  (parallel to the Redis→memory fallback).
- **route handlers** — `/session` creates from `{ player, ttlMs }` only.
- **`.env.example`** — add `IDENTITY_CONTRACT`, `RPC_URL`; update `CHAIN_ID`.

## Testing

`node --test` with `--experimental-strip-types`, strict TDD (red → green).

- **Verifier unit tests:** fake returns verified/unverified/linked-root; onchain
  verifier maps a mocked `getWhitelistedRoot` response (non-zero and zero) to the
  right `IdentityCheck`, against an injected transport (offline).
- **Settle tests (new):**
  - unverified player on an above-bar run → `not_verified` **and the session is
    NOT consumed** (a follow-up settle after the fake flips to verified →
    `accepted`).
  - verified player → `accepted`, voucher signed, cap keyed on root.
  - two distinct wallets sharing one root → second run sees the first's spend
    (shared daily cap).
  - below-bar run never calls the verifier (spy verifier asserts zero calls).
- **Existing suites stay green** (engine replay, voucher, reward, store
  contract, api), adjusted only where the `identity` field was removed.

## Out of scope (explicit)

- Any React / Privy code, the smart-wallet/paymaster wiring, the withdraw UI.
- Whitelist expiry / re-verification cadence.
- On-chain identity calls in `GameRewards.sol` (the gate is off-chain at
  signing; the contract already enforces the per-epoch cap backstop).
