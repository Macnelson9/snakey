// api.test.ts — the JSON boundary. Vouchers carry bigint amount/deadline, which
// JSON.stringify cannot encode; these helpers must emit decimal strings so the
// payload is serializable and the client can hand exact values to the contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSettle, serializeSession, parseSessionBody, parseSettleBody } from "./api.ts";
import type { SettleResult } from "./settle.ts";
import type { SessionRecord } from "./session/store.ts";

const session: SessionRecord = {
  runId: "0xabc0000000000000000000000000000000000000000000000000000000000001",
  seed: 0xc0ffee,
  player: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  issuedAt: 1_700_000_000_000,
  used: false,
};

const accepted: SettleResult = {
  status: "accepted",
  score: 290,
  ticks: 387,
  foodEaten: 29,
  died: true,
  amount: 1_700000000000000000n,
  flagged: false,
  flags: [],
  signed: {
    signer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    signature: "0xdeadbeef",
    voucher: {
      player: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      runId: "0xabc0000000000000000000000000000000000000000000000000000000000001",
      amount: 1_700000000000000000n,
      deadline: 1_900_000_000n,
    },
  },
};

test("serializeSession exposes runId/seed/issuedAt and is JSON-safe", () => {
  const out = serializeSession(session);
  assert.equal(out.runId, session.runId);
  assert.equal(out.seed, session.seed);
  assert.equal(out.issuedAt, session.issuedAt);
  assert.doesNotThrow(() => JSON.stringify(out));
});

test("serializeSettle encodes bigints as decimal strings and never leaks a bigint", () => {
  const out = serializeSettle(accepted);
  assert.equal(out.status, "accepted");
  if (out.status !== "accepted") return;
  assert.equal(out.amount, "1700000000000000000");
  assert.equal(out.voucher.amount, "1700000000000000000");
  assert.equal(out.voucher.deadline, "1900000000");
  assert.equal(out.signature, "0xdeadbeef");
  assert.equal(out.voucher.player, session.player);
  // The whole point: this must round-trip through JSON without throwing.
  const json = JSON.stringify(out);
  assert.ok(!json.includes("n,"), "no bigint literals");
  assert.equal(JSON.parse(json).amount, "1700000000000000000");
});

test("serializeSettle preserves rejected and no_reward shapes", () => {
  const rejected = serializeSettle({ status: "rejected", reason: "replay" });
  assert.deepEqual(rejected, { status: "rejected", reason: "replay" });

  const noReward = serializeSettle({
    status: "no_reward",
    reason: "cap_reached",
    score: 290,
    ticks: 387,
    amount: 0n,
  });
  assert.equal(noReward.status, "no_reward");
  if (noReward.status !== "no_reward") return;
  assert.equal(noReward.amount, "0");
  assert.doesNotThrow(() => JSON.stringify(noReward));
});

test("parseSessionBody accepts a body carrying only the player wallet", () => {
  // The client no longer asserts an identity — the server derives it on-chain at
  // settle (the GoodDollar gate). /session needs only the payout wallet.
  const r = parseSessionBody({ player: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.player, "0x70997970C51812dc3A010C7d01b50e0d17dc79C8");
});

test("parseSessionBody rejects a bad or missing player", () => {
  assert.equal(parseSessionBody({ player: "nope" }).ok, false);
  assert.equal(parseSessionBody({ player: "0x123" }).ok, false);
  assert.equal(parseSessionBody({}).ok, false);
  assert.equal(parseSessionBody(null).ok, false);
});

test("parseSettleBody requires a runId hex and an inputs array", () => {
  const ok = parseSettleBody({ runId: "0x" + "ab".repeat(32), inputs: [{ tick: 0, dir: 1 }] });
  assert.ok(ok.ok);
  assert.equal(parseSettleBody({ runId: "0x" + "ab".repeat(32) }).ok, false, "inputs required");
  assert.equal(parseSettleBody({ runId: "nothex", inputs: [] }).ok, false);
  assert.equal(parseSettleBody({ inputs: [] }).ok, false);
  assert.equal(parseSettleBody(undefined).ok, false);
});
