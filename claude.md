# Nokiadot (working name — rename when finalized)

A nostalgic **Snake / Xenzia** game as a PWA, on **Celo**, integrating **GoodDollar (G$)**.
Anyone — including non-web3 users — plays instantly with an invisible wallet, one tap, zero
gas. Verified humans earn small G$ rewards funded by a streamed public-goods grant.

> This file is the handoff from a planning session. It is the source of truth for _why_
> things are the way they are. Read it fully before making architectural changes.

## Funding context (why this project exists in this shape)

- Applying to a **FlowState Flow Council on Celo** (chain id **42220**). FlowState streams
  funding continuously via **Superfluid** — council members vote, accepted projects receive a
  real-time G$ stream into the project wallet. This sits under the **GoodDollar GoodBuilders**
  ecosystem program.
- GoodBuilders **rejects trivial G$ integrations** ("we show a G$ balance" fails). The
  integration here is substantive: the streamed grant G$ **flows through the game to humans**
  as rewards, gated by sybil-resistant GoodDollar identity.
- **Hard deadline.** Bias every decision toward shipping the full loop on testnet over polish.

## Core architecture decisions (already made — do not relitigate without reason)

1. **Game is 100% client-side and deterministic.** The chain is only touched at _settlement_
   moments (reward payout, identity gate). NEVER put a move on-chain. Treat the chain as the
   bank + notary, never the game engine.
2. **One shared TypeScript engine** (`engine.ts`) is imported by BOTH the client render loop
   and the server replay verifier. Same file both sides ⇒ scores cannot diverge. (We
   deliberately dropped a Rust/WASM engine to save time; Snake never needs that perf.)
3. **Wallet:** Privy embedded wallet, created silently as a guest on first load ("one signature
   and play"). Privy **smart wallet** (Safe) + **paymaster** ⇒ gas-sponsored, zero balance
   needed. Upgrade to email/social login ONLY when the user wants to withdraw.
   Privy is v3 (`@privy-io/react-auth`). **HTTPS is required everywhere** (key-sharding fails
   silently on http, even on LAN IPs).
4. **Identity gate:** `@goodsdks/citizen-sdk` (GoodDollar Identity SDK, Viem/Wagmi based).
   Checked **before payout, never before play.** Play is anonymous and instant; GoodDollar
   face-verification is opt-in, triggered only at withdraw.
5. **Bot resistance lives in the reward curve, not the verifier.** Payouts are **sub-linear in
   score** with a **hard per-identity daily cap** + identity gating. A bot scoring 99,999 earns
   the same capped amount as a human who cleared the bar, so nobody bothers botting.

## Score-integrity backend (the keystone — see engine.ts + replay.test.ts)

`engine.ts` is deterministic and integer-only: seeded uint32 PRNG (mulberry32), tick-based
clock. **No floats, no `Math.random`, no `Date.now` anywhere in the engine.** Any change must
keep `replay.test.ts` green.

Flow:

1. `POST /session` → server generates a CSPRNG `seed`, stores `{runId, seed, identity, issuedAt,
used:false}` (single-use, time-boxed, identity-bound), returns the seed. No scoreable run can
   start without it (closes seed precomputation).
2. Client plays locally on `engine.ts`, logging `(tick, dir)` inputs.
3. `POST /settle { runId, inputs }` → server reloads the session, runs
   `simulate(seed, inputs)` on the **same** engine ⇒ authoritative score. The client-claimed
   score is never trusted. Gates: wall-clock plausibility (server timestamps only), input-timing
   heuristics (flag for review, don't hard-block), per-identity daily cap.
4. Valid ⇒ server signs an **EIP-712 voucher** `{player, runId, amount, deadline}`, marks the
   session used, returns it.
5. Client redeems the voucher on `GameRewards` (gas sponsored) ⇒ G$ released.

**Scorer signer key = crown jewel.** Keep in KMS/HSM, plan rotation, and enforce an on-chain
**per-epoch payout cap** so a leaked key can't drain more than one epoch before rotation.

## Contracts

- `GameRewards.sol` — holds the G$ reward pool. `redeem(voucher, sig)`:
  EIP-712 verify against trusted `scorer` address, `consumed[runId]` replay guard, deadline
  check, per-epoch cap, then transfer G$ to `player`. Build/test with **Foundry**.

## Stack

- **Frontend:** Next.js (App Router) PWA. Service worker so the game plays offline and queues
  chain calls until reconnect. Tailwind. **Monochrome black-and-white dot-matrix design system**
  — lean into the Nokia LCD aesthetic: pixel-grid cells, faint "off-pixel" ghosting under lit
  cells, monospace numerals. The nostalgia and the minimalism are the same constraint.
- **Backend:** Node (imports the shared `engine.ts`). Postgres or Redis for sessions, consumed
  `runId`s, nonces, per-identity daily counters. The verifier is stateless; anti-replay and
  rate-limiting are stateful. Can live as Next.js route handlers or a separate `apps/api`.
- **Chain:** Celo. G$ token. Privy paymaster (+ Alchemy/Pimlico bundler if needed).

## Target repo layout

```
packages/engine/      engine.ts, replay.test.ts   (shared client+server, DONE)
apps/web/             Next.js PWA + dot-matrix design system
apps/api/             /session, /settle, EIP-712 voucher signer   (or web route handlers)
contracts/            Foundry: GameRewards.sol + tests
```

## Status

- **DONE:** deterministic engine + replay test. Passing checks: live score == server-replay
  score, repeated-replay determinism, tamper-evidence (claimed score ignored), seed-binding
  (same inputs on a new seed ⇒ different score), input-order irrelevance.
- **NEXT (in order):**
  1. `/session` + `/settle` with EIP-712 voucher signing wrapped around `engine.ts`.
  2. `GameRewards.sol` + Foundry tests.
  3. Privy (silent guest → smart wallet → sponsored tx) + GoodDollar identity gate at withdraw.
  4. PWA shell + the monochrome dot-matrix design system + render loop on `engine.ts`.

## Open blockers (owner: Uche)

- **Privy App ID**, smart wallets enabled, paymaster registered in the Privy dashboard.
- **Network choice:** Alfajores testnet (demo) vs Celo mainnet 42220 (real G$). Confirm whether
  GoodDollar Identity contracts are deployed on Alfajores; if mainnet-only, gate against mainnet
  G$ and run everything else on testnet.
- Funded **deployer key**; **hosting** (Vercel + Neon/Upstash); **RPC/bundler** key.
- Final **game name**.

## Conventions

- The engine stays pure. No floats / `Math.random` / `Date.now` in `engine.ts`. Every engine
  change re-runs `replay.test.ts` and it must stay green.
- Server is the only authority on score. Never trust a client-submitted score value.
