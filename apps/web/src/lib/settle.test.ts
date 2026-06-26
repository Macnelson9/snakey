// settle.test.ts — the keystone backend path. Proves /settle never trusts a
// client-claimed score (it replays on the shared engine), enforces single-use
// sessions, wall-clock plausibility, the sub-linear reward + daily cap, and
// emits an EIP-712 voucher that recovers to the scorer. Driven against the
// in-memory store with an injected clock and a pinned seed so scoring is
// deterministic.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import {
  createState, setDir, step, simulate,
  DX, DY, OPPOSITE,
  type State, type Dir, type Input,
} from "@nokiadot/engine";
import { createMemoryStore } from "./session/memory-store.ts";
import { recoverVoucherSigner } from "./voucher.ts";
import { rewardForScore, REWARD_PARAMS, G$ } from "./reward.ts";
import { settle, type SettleParams } from "./settle.ts";

const SCORER_PK = "0xac0974bec39a17e36ba4a6b4d238ff944b6b0be62e1b6b5a3f6e1e9f6c8b6a1e" as const;
const PLAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const;
const IDENTITY = PLAYER.toLowerCase();
const PINNED_SEED = 0xc0ffee; // greedy bot scores 290 over 387 ticks on this seed
const VCTX = { chainId: 44787, verifyingContract: "0x1111111111111111111111111111111111111111" as const };

// A deterministic greedy "client" (same shape as replay.test.ts) that plays the
// engine live and records the input log a real client would POST.
function greedyLog(seed: number, cap = 4000): { inputs: Input[]; score: number; ticks: number } {
  const choose = (s: State): Dir => {
    const head = s.snake[0]!;
    let best: Dir = s.dir, bestDist = Infinity;
    for (const d of [0, 1, 2, 3] as Dir[]) {
      if (d === OPPOSITE[s.dir]) continue;
      const nx = head.x + DX[d], ny = head.y + DY[d];
      if (nx < 0 || ny < 0 || nx >= 20 || ny >= 20) continue;
      const ate = nx === s.food.x && ny === s.food.y;
      const body = ate ? s.snake : s.snake.slice(0, s.snake.length - 1);
      if (body.some((c) => c.x === nx && c.y === ny)) continue;
      const dist = Math.abs(nx - s.food.x) + Math.abs(ny - s.food.y);
      if (dist < bestDist) { bestDist = dist; best = d; }
    }
    return best;
  };
  const s = createState(seed);
  const inputs: Input[] = [];
  while (s.alive && s.tick < cap) {
    const d = choose(s);
    if (d !== s.pendingDir) { setDir(s, d); inputs.push({ tick: s.tick, dir: d }); }
    step(s);
  }
  return { inputs, score: s.score, ticks: s.tick };
}

// Build a settle harness with an injectable clock and a pinned session seed.
function harness(overrides: Partial<SettleParams> = {}) {
  let t = 1_700_000_000_000;
  const clock = { now: () => t, advance: (ms: number) => { t += ms; } };
  const store = createMemoryStore(clock.now, () => PINNED_SEED);
  const params: SettleParams = {
    store,
    scorerPrivateKey: SCORER_PK,
    voucherContext: VCTX,
    dailyCap: G$(10),
    minMsPerTick: 50,
    voucherTtlMs: 10 * 60_000,
    now: clock.now,
    ...overrides,
  };
  return { store, params, clock };
}

async function issue(store: SettleParams["store"]) {
  return store.create({ player: PLAYER, identity: IDENTITY, ttlMs: 60 * 60_000 });
}

test("happy path: replays to the authoritative score and signs a recoverable voucher", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  const log = greedyLog(session.seed);
  assert.ok(log.score >= REWARD_PARAMS.qualifyingScore, "fixture sanity: run clears the bar");
  clock.advance(log.ticks * params.minMsPerTick + 5_000); // plausibly enough wall time

  const res = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(res.status, "accepted");
  if (res.status !== "accepted") return;

  // Authoritative score equals an independent replay, NOT any client claim.
  const authoritative = simulate(session.seed, log.inputs);
  assert.equal(res.score, authoritative.score);
  assert.equal(res.amount, rewardForScore(authoritative.score));

  const recovered = await recoverVoucherSigner(res.signed.voucher, res.signed.signature, VCTX);
  assert.equal(recovered, privateKeyToAccount(SCORER_PK).address);
  assert.equal(res.signed.voucher.player, PLAYER);
  assert.equal(res.signed.voucher.runId, session.runId);
  assert.equal(res.signed.voucher.amount, res.amount);
  assert.equal(res.signed.voucher.deadline, BigInt(params.now!() + params.voucherTtlMs) / 1000n);
});

test("a fabricated higher claimed score is irrelevant — server pays for the replay", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  const log = greedyLog(session.seed);
  clock.advance(log.ticks * params.minMsPerTick + 5_000);
  // The request carries only (runId, inputs); there is nowhere to put a claim.
  const res = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(res.status, "accepted");
  if (res.status !== "accepted") return;
  assert.ok(res.amount < G$(99_999), "no path to inflate payout via a claim");
});

test("single-use: a session cannot be settled twice (replay guard)", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  const log = greedyLog(session.seed);
  clock.advance(log.ticks * params.minMsPerTick + 5_000);
  const first = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(first.status, "accepted");
  const second = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(second.status, "rejected");
  if (second.status === "rejected") assert.equal(second.reason, "replay");
});

test("unknown session is rejected", async () => {
  const { params } = harness();
  const res = await settle(params, { runId: "0x" + "ab".repeat(32), inputs: [] });
  assert.equal(res.status, "rejected");
  if (res.status === "rejected") assert.equal(res.reason, "unknown_session");
});

test("implausibly fast submission is rejected on server wall-clock", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  const log = greedyLog(session.seed);
  clock.advance(100); // far less than ticks * minMsPerTick
  const res = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(res.status, "rejected");
  if (res.status === "rejected") assert.equal(res.reason, "implausible_timing");
});

test("below the qualifying bar earns no voucher", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  clock.advance(60_000);
  // No direction changes: the snake runs straight into the wall, score 0.
  const res = await settle(params, { runId: session.runId, inputs: [] });
  assert.equal(res.status, "no_reward");
  if (res.status === "no_reward") {
    assert.equal(res.reason, "below_bar");
    assert.equal(res.amount, 0n);
  }
});

test("daily cap: a fully-capped identity earns no voucher", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  const day = new Date(params.now!()).toISOString().slice(0, 10);
  await store.addDailyTotal(IDENTITY, day, params.dailyCap); // already at cap
  const log = greedyLog(session.seed);
  clock.advance(log.ticks * params.minMsPerTick + 5_000);
  const res = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(res.status, "no_reward");
  if (res.status === "no_reward") assert.equal(res.reason, "cap_reached");
});

test("daily cap: a partial remainder clamps the payout and exhausts the cap", async () => {
  const remaining = G$(1) / 2n; // 0.5 G$ left
  const { store, params, clock } = harness({ dailyCap: G$(10) });
  const session = await issue(store);
  const day = new Date(params.now!()).toISOString().slice(0, 10);
  await store.addDailyTotal(IDENTITY, day, params.dailyCap - remaining);
  const log = greedyLog(session.seed);
  assert.ok(rewardForScore(log.score) > remaining, "fixture: uncapped reward exceeds remainder");
  clock.advance(log.ticks * params.minMsPerTick + 5_000);
  const res = await settle(params, { runId: session.runId, inputs: log.inputs });
  assert.equal(res.status, "accepted");
  if (res.status !== "accepted") return;
  assert.equal(res.amount, remaining, "payout clamped to remaining cap");
  assert.equal(await store.getDailyTotal(IDENTITY, day), params.dailyCap, "cap now exhausted");
});

test("malformed inputs are rejected before scoring", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  clock.advance(60_000);
  const res = await settle(params, {
    runId: session.runId,
    inputs: [{ tick: 0, dir: 7 as Dir }],
  });
  assert.equal(res.status, "rejected");
  if (res.status === "rejected") assert.equal(res.reason, "invalid_input");
});

test("padding the log with inputs for never-reached ticks is accepted but flagged", async () => {
  const { store, params, clock } = harness();
  const session = await issue(store);
  const log = greedyLog(session.seed);
  clock.advance(log.ticks * params.minMsPerTick + 5_000);
  const padded = [...log.inputs, { tick: 999_999, dir: 2 as Dir }];
  const res = await settle(params, { runId: session.runId, inputs: padded });
  assert.equal(res.status, "accepted");
  if (res.status !== "accepted") return;
  assert.ok(res.flagged, "future-tick padding raises a review flag");
  assert.ok(res.flags.includes("future_inputs"));
  // Flagged, but still paid the authoritative score — flags review, never block.
  assert.equal(res.score, simulate(session.seed, padded).score);
});
