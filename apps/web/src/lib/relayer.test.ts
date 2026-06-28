import { test } from "node:test";
import assert from "node:assert/strict";
import { createRelayer, GAME_REWARDS_ABI } from "./relayer.ts";

const ANVIL_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944b6b0be62e1b6b5a3f6e1e9f6c8b6a1e" as const;

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
