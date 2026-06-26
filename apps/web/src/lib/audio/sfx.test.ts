import { test } from "node:test";
import assert from "node:assert/strict";
import { CUES, createSfx } from "./sfx.ts";

test("every cue exists with at least one positive-frequency step", () => {
  for (const name of ["eat", "die", "highscore", "start", "tap"] as const) {
    const cue = CUES[name];
    assert.ok(cue && cue.steps.length > 0, `cue ${name}`);
    for (const s of cue.steps) { assert.ok(s.freq > 0); assert.ok(s.ms > 0); }
  }
});

test("createSfx is a safe no-op without Web Audio (node)", () => {
  const sfx = createSfx(true);
  assert.doesNotThrow(() => { sfx.unlock(); sfx.play("eat"); sfx.setEnabled(false); sfx.play("die"); });
});
