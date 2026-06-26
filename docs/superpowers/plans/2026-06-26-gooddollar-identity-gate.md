# GoodDollar Identity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/settle` derive the player's identity from on-chain GoodDollar state and gate G$ vouchers on it, so the per-identity daily cap (the sybil-resistance mechanism) is keyed on a verified human, not a client-supplied string.

**Architecture:** A new `lib/identity/` module exposes an `IdentityVerifier` interface with an on-chain implementation (viem → GoodDollar `getWhitelistedRoot`) and a fake (tests + dev). `settle()` is reordered so identity is checked before payout but with consume placement chosen so unverified runs survive for retry while implausibly-fast runs are burned. The client-supplied `identity` field is removed end-to-end; the daily cap is keyed on the GoodDollar root.

**Tech Stack:** TypeScript (Node `--experimental-strip-types`), `node --test`, viem, Next.js route handlers.

## Global Constraints

- Server is the only authority on score and identity — never trust a client-submitted value.
- Engine stays pure; `replay.test.ts` must stay green (this plan does not touch the engine).
- Both identity and rewards on Celo mainnet (chain id 42220); `CHAIN_ID` default → `42220`.
- Whitelist expiry re-checking is out of scope: a non-zero root = verified.
- No React/Privy code in this plan.
- `node --test` via the package `test` script: `node --experimental-strip-types --disable-warning=ExperimentalWarning --test "src/**/*.test.ts"` run from `apps/web`.

---

### Task 1: Identity verifier module

**Files:**
- Create: `apps/web/src/lib/identity/verifier.ts`
- Create: `apps/web/src/lib/identity/fake-verifier.ts`
- Create: `apps/web/src/lib/identity/onchain-verifier.ts`
- Test: `apps/web/src/lib/identity/verifier.test.ts`

**Interfaces:**
- Produces: `IdentityCheck = { verified: boolean; root: string }`; `IdentityVerifier = { check(player: Address): Promise<IdentityCheck> }`; `createFakeVerifier(opts?) => IdentityVerifier & { calls: Address[] }`; `createOnchainVerifier({ client: PublicClient; contract: Address }) => IdentityVerifier`.

- [ ] **Step 1: Write verifier.ts (types only)** — interface + IdentityCheck as above.
- [ ] **Step 2: Write fake-verifier.ts** — `createFakeVerifier({ roots?: Record<string,string>; selfRoot?: boolean })`: pushes each player to `calls`; returns mapped root (verified) if present, else self as root when `selfRoot`, else `{ verified:false, root:"" }`. All addresses lowercased.
- [ ] **Step 3: Write onchain-verifier.ts** — minimal inline ABI for `getWhitelistedRoot(address)->address`; `client.readContract`; zero address ⇒ unverified, else `{ verified:true, root: root.toLowerCase() }`.
- [ ] **Step 4: Write verifier.test.ts** — fake: verified/unverified/linked-root + `calls` recorded. onchain: custom-transport PublicClient returns an encoded non-zero address ⇒ verified+root; encoded zero ⇒ unverified.
- [ ] **Step 5: Run** `npm test` (from apps/web). Expected: new tests pass, suite green.
- [ ] **Step 6: Commit.**

### Task 2: Drop client identity from the store layer

**Files:**
- Modify: `apps/web/src/lib/session/store.ts` (remove `identity` from `SessionRecord` + `CreateSessionInput`)
- Modify: `apps/web/src/lib/session/memory-store.ts` (drop `identity:` in create)
- Modify: `apps/web/src/lib/session/redis-store.ts` (drop `identity` from hset + get)
- Modify: `apps/web/src/lib/session/store-contract.ts` (drop identity from create calls + the `s.identity` assertion)

**Interfaces:**
- Produces: `CreateSessionInput = { player: Address; ttlMs: number }`; `SessionRecord` without `identity`. Daily-cap methods unchanged (still `(identity: string, dayKey)` — the arg is now fed the root at the call site).

- [ ] **Step 1:** Remove `identity` from `SessionRecord` and `CreateSessionInput` in store.ts.
- [ ] **Step 2:** Remove `identity:` from memory-store create; remove from redis-store hset and the `get` mapping.
- [ ] **Step 3:** In store-contract.ts remove `identity: IDENTITY` from every `create({...})` and delete `assert.equal(s.identity, IDENTITY)`. Keep the `IDENTITY` constant for the daily-cap key tests.
- [ ] **Step 4: Run** `npm test`. Expected: store-contract green (settle/api still red until later tasks — that's fine, note which).
- [ ] **Step 5: Commit.**

### Task 3: Reorder settle + identity gate

**Files:**
- Modify: `apps/web/src/lib/settle.ts`
- Modify: `apps/web/src/lib/settle.test.ts`

**Interfaces:**
- Consumes: `IdentityVerifier`, `createFakeVerifier` from Task 1.
- Produces: `SettleParams` gains `identityVerifier: IdentityVerifier`; `NoRewardReason = "below_bar" | "cap_reached" | "not_verified"`.

- [ ] **Step 1 (red):** Update settle.test.ts: `harness` adds `identityVerifier: createFakeVerifier({ selfRoot: true })`; `issue` drops `identity`. Add three tests — (a) unverified ⇒ `not_verified` AND `store.get(runId).used === false`, then re-settle with a verified verifier ⇒ accepted; (b) two wallets mapped to one root share the cap (second ⇒ `cap_reached` with `dailyCap = rewardForScore(firstScore)`); (c) below-bar run leaves `verifier.calls.length === 0`.
- [ ] **Step 2: Run** — expect failures (no `identityVerifier` field, no `not_verified`).
- [ ] **Step 3 (green):** Edit settle.ts — add `not_verified` to `NoRewardReason`; add `identityVerifier` to `SettleParams`. Reorder: validInputs → get → simulate → flags → reward(0⇒below_bar, no consume) → `identityVerifier.check(session.player)` (`!verified`⇒`not_verified`, no consume) → `consume` (false⇒replay) → timing (⇒implausible_timing) → cap on `id.root` → sign.
- [ ] **Step 4: Run** `npm test`. Expected: all settle tests pass.
- [ ] **Step 5: Commit.**

### Task 4: API boundary

**Files:**
- Modify: `apps/web/src/lib/api.ts` (`parseSessionBody` → player only; `SessionBody` drops identity)
- Modify: `apps/web/src/lib/api.test.ts` (session fixture + parseSessionBody tests)

**Interfaces:**
- Produces: `SessionBody = { player: Address }`. `SerializedSettle` no_reward already carries `reason: NoRewardReason`, so `not_verified` flows with no change; `settleHttpStatus` no_reward stays `200`.

- [ ] **Step 1 (red):** In api.test.ts remove `identity` from the `SessionRecord` fixture; rewrite the two `parseSessionBody` tests to assert player-only acceptance and rejection of a missing/invalid player.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3 (green):** In api.ts drop `identity` from `SessionBody` and its validation/normalization in `parseSessionBody`.
- [ ] **Step 4: Run** `npm test`. Expected: green.
- [ ] **Step 5: Commit.**

### Task 5: Config, routes, env wiring

**Files:**
- Modify: `apps/web/src/lib/config.ts` (add `getIdentityVerifier()`; `getSettleParams` includes it; `CHAIN_ID` default 42220)
- Modify: `apps/web/src/app/api/session/route.ts` (create with `{ player, ttlMs }`)
- Modify: `apps/web/.env.example` (`IDENTITY_CONTRACT`, `RPC_URL`, `CHAIN_ID=42220`)

**Interfaces:**
- Consumes: `createOnchainVerifier`, `createFakeVerifier` (Task 1); `getSettleParams` shape (Task 3).

- [ ] **Step 1:** `getIdentityVerifier()` — if `IDENTITY_CONTRACT` and `RPC_URL` set: `createOnchainVerifier({ client: createPublicClient({ chain: celo, transport: http(RPC_URL) }), contract })`; else in production throw, in dev warn + `createFakeVerifier({ selfRoot: true })`. Add to `getSettleParams`. `CHAIN_ID` default → 42220.
- [ ] **Step 2:** session route: `create({ player: parsed.value.player, ttlMs: getSessionTtlMs() })`.
- [ ] **Step 3:** `.env.example`: add `IDENTITY_CONTRACT=` (GoodDollar Identity on Celo — confirm address against GoodDollar docs), `RPC_URL=`, set `CHAIN_ID=42220` with a "real G$" note.
- [ ] **Step 4: Run** `npm test` + `npm run typecheck` (apps/web) + `npx tsc --noEmit` clean.
- [ ] **Step 5: Final verification:** `pnpm test` from repo root — engine + web + contracts all green.
- [ ] **Step 6: Commit.**
