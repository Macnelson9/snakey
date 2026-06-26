// reward.test.ts — the reward curve is the actual bot-resistance mechanism
// (CLAUDE.md decision #5: "Bot resistance lives in the reward curve, not the
// verifier"). These tests pin the economic properties that make botting
// pointless: a hard per-run ceiling, sub-linear growth, and a qualifying bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isqrt,
  rewardForScore,
  REWARD_PARAMS,
  G$,
} from "./reward.ts";

test("isqrt computes integer floor of the square root", () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(15n), 3n);
  assert.equal(isqrt(16n), 4n);
  assert.equal(isqrt(99_999n), 316n); // 316^2 = 99856, 317^2 = 100489
  assert.equal(isqrt(10n ** 36n), 10n ** 18n);
});

test("isqrt rejects negative input", () => {
  assert.throws(() => isqrt(-1n));
});

test("score below the qualifying bar earns nothing", () => {
  assert.equal(rewardForScore(0), 0n);
  assert.equal(rewardForScore(REWARD_PARAMS.qualifyingScore - 1), 0n);
});

test("clearing the qualifying bar earns a positive reward", () => {
  assert.ok(rewardForScore(REWARD_PARAMS.qualifyingScore) > 0n);
});

test("reward is monotonically non-decreasing in score", () => {
  let prev = 0n;
  for (let s = 0; s <= 5000; s += 10) {
    const r = rewardForScore(s);
    assert.ok(r >= prev, `reward dropped at score ${s}: ${r} < ${prev}`);
    prev = r;
  }
});

test("reward is sub-linear: doubling score does not double reward", () => {
  // Pick a score comfortably above the bar but below saturation.
  const s = 100;
  const r1 = rewardForScore(s);
  const r2 = rewardForScore(s * 2);
  assert.ok(r2 > r1, "more score should still pay more in the growth region");
  assert.ok(r2 < r1 * 2n, "doubling score must pay strictly less than double");
});

test("reward never exceeds the hard per-run ceiling", () => {
  for (const s of [100, 1000, 10_000, 99_999, 1_000_000]) {
    assert.ok(rewardForScore(s) <= REWARD_PARAMS.maxPerRun);
  }
});

test("a bot's astronomical score earns exactly the same capped amount as a modest saturating human", () => {
  // The crux of decision #5: once past saturation, extra score is worthless.
  const human = rewardForScore(REWARD_PARAMS.saturatingScore);
  const bot = rewardForScore(99_999);
  assert.equal(human, REWARD_PARAMS.maxPerRun);
  assert.equal(bot, REWARD_PARAMS.maxPerRun);
  assert.equal(bot, human);
});

test("G$ helper converts whole tokens to 18-decimal wei", () => {
  assert.equal(G$(1), 10n ** 18n);
  assert.equal(G$(0), 0n);
});
