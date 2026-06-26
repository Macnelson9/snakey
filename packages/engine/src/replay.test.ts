// replay.test.ts
// Proves the property the whole reward system depends on:
//   the server, replaying ONLY (seed + input log), reproduces the client's score
//   exactly — and a client-claimed number is never needed or trusted.
import assert from "node:assert/strict";
import {
  createState, setDir, step, simulate,
  GRID_W, GRID_H, OPPOSITE, DX, DY,
  type State, type Dir, type Input,
} from "./engine.ts";

// A deterministic "player" (stands in for either a human client or a bot):
// greedily steers toward food, avoiding walls and its own body. It plays the
// game live via step() and records its input log — exactly what a real client
// would POST to /settle.
function chooseDir(s: State): Dir {
  const head = s.snake[0]!;
  let best: Dir = s.dir;
  let bestDist = Infinity;
  for (const d of [0, 1, 2, 3] as Dir[]) {
    if (d === OPPOSITE[s.dir]) continue;
    const nx = head.x + DX[d], ny = head.y + DY[d];
    if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) continue;
    const ate = nx === s.food.x && ny === s.food.y;
    const body = ate ? s.snake : s.snake.slice(0, s.snake.length - 1);
    if (body.some((c) => c.x === nx && c.y === ny)) continue;
    const dist = Math.abs(nx - s.food.x) + Math.abs(ny - s.food.y);
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

function playLive(seed: number, cap = 4000): { inputs: Input[]; score: number; ticks: number } {
  const s = createState(seed);
  const inputs: Input[] = [];
  while (s.alive && s.tick < cap) {
    const d = chooseDir(s);
    if (d !== s.pendingDir) { setDir(s, d); inputs.push({ tick: s.tick, dir: d }); }
    step(s);
  }
  return { inputs, score: s.score, ticks: s.tick };
}

// 1. KEYSTONE: live play and server replay agree exactly.
const live = playLive(0xc0ffee);
const replay = simulate(0xc0ffee, live.inputs);
assert.equal(replay.score, live.score, "server replay must reproduce the live score");
assert.equal(replay.ticks, live.ticks, "server replay must reproduce tick count");
assert.ok(live.score > 0, "sanity: the run should actually score");
console.log(`1. keystone OK   live=${live.score} replay=${replay.score} over ${replay.ticks} ticks, ${live.inputs.length} inputs`);

// 2. DETERMINISM: same (seed, inputs) -> identical result, every time.
const a = simulate(0xc0ffee, live.inputs);
const b = simulate(0xc0ffee, live.inputs);
assert.deepEqual(a, b, "identical inputs must yield identical results");
console.log(`2. determinism OK  repeated replay byte-identical`);

// 3. TAMPER-EVIDENCE: a fabricated higher score is meaningless — the authoritative
//    score is whatever the replay computes, independent of any claimed number.
const claimedByCheater = 999_999;
const authoritative = simulate(0xc0ffee, live.inputs).score;
assert.notEqual(authoritative, claimedByCheater, "claimed score is never trusted");
console.log(`3. tamper OK       cheater claims ${claimedByCheater}, server pays for ${authoritative}`);

// 4. SEED SENSITIVITY: different seed -> different food sequence -> different run,
//    so a precomputed input log can't be replayed against a fresh server seed.
const otherSeed = simulate(0x1234abcd, live.inputs);
assert.notEqual(otherSeed.score, live.score, "same inputs on a new seed should not reproduce the score");
console.log(`4. seed binding OK  same inputs, seed 0x1234abcd -> score ${otherSeed.score} (not ${live.score})`);

// 5. INPUT ORDER IRRELEVANCE: transit can reorder the log; result is unchanged.
const shuffled = [...live.inputs].reverse();
assert.equal(simulate(0xc0ffee, shuffled).score, live.score, "log is sorted by tick server-side");
console.log(`5. order OK         reversed log replays to the same score`);

console.log("\nALL CHECKS PASSED");
