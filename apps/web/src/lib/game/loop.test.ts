import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, type Dir } from "@buga/engine";
import { msPerTick, createRunController, MS_PER_TICK_BASE, MS_PER_TICK_FLOOR } from "./loop.ts";

test("msPerTick ramps from base toward the floor and never below", () => {
  assert.equal(msPerTick(0), MS_PER_TICK_BASE);
  assert.ok(msPerTick(5) < MS_PER_TICK_BASE);
  assert.ok(msPerTick(1000) >= MS_PER_TICK_FLOOR);
});

test("queueDir logs an input only when pendingDir actually changes", () => {
  const c = createRunController(0xc0ffee);
  c.queueDir(1); // already moving right at start -> no change
  assert.equal(c.inputs.length, 0);
  c.queueDir(0); // up -> a real turn
  assert.equal(c.inputs.length, 1);
  c.queueDir(3); // left reverses the committed (un-stepped) right heading -> engine rejects, no log
  assert.equal(c.inputs.length, 1);
});

test("advance steps the right number of ticks for elapsed wall-time", () => {
  const c = createRunController(0xc0ffee);
  const stepped = c.advance(MS_PER_TICK_BASE * 3 + 5);
  assert.equal(stepped, 3);
  assert.equal(c.state.tick, 3);
});

test("the recorded input log replays to the same score (client == server)", () => {
  const c = createRunController(0xc0ffee);
  const turns: Array<[number, Dir]> = [[2, 0], [6, 1], [10, 2], [14, 3]];
  let ti = 0;
  // Drive ~400 ticks, applying scripted turns at their tick.
  for (let i = 0; i < 4000 && c.alive; i++) {
    while (ti < turns.length && turns[ti]![0] === c.state.tick) { c.queueDir(turns[ti]![1]); ti++; }
    c.advance(MS_PER_TICK_FLOOR);
  }
  const replay = simulate(0xc0ffee, c.inputs);
  assert.equal(replay.score, c.state.score);
  assert.equal(replay.ticks, c.state.tick);
});
