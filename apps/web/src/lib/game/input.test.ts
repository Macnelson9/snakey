import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeToDir, keyToDir } from "./input.ts";

test("swipeToDir picks the dominant axis (screen y grows down)", () => {
  assert.equal(swipeToDir(40, 0), 1);   // right
  assert.equal(swipeToDir(-40, 0), 3);  // left
  assert.equal(swipeToDir(0, 40), 2);   // down
  assert.equal(swipeToDir(0, -40), 0);  // up
  assert.equal(swipeToDir(40, 10), 1);  // mostly horizontal
});

test("swipeToDir ignores sub-threshold swipes", () => {
  assert.equal(swipeToDir(5, 5), null);
  assert.equal(swipeToDir(10, 0, 24), null);
});

test("keyToDir maps arrows and WASD, null otherwise", () => {
  assert.equal(keyToDir("ArrowUp"), 0);
  assert.equal(keyToDir("d"), 1);
  assert.equal(keyToDir("S"), 2);
  assert.equal(keyToDir("a"), 3);
  assert.equal(keyToDir("Enter"), null);
});
