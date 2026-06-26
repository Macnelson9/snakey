// engine.ts
// Deterministic, integer-only Snake engine. SINGLE SOURCE OF TRUTH:
// the client imports it for its render loop, the server imports the same file
// to authoritatively replay a submitted input log. Because both sides run this
// exact module, scores cannot diverge between play and verification.
//
// Hard rules that keep it deterministic across machines:
//   - No floats. Every piece of state is an integer.
//   - No Math.random(). RNG is a seeded uint32 PRNG (mulberry32).
//   - No Date.now() / wall-clock. Time is measured in integer ticks.

export const GRID_W = 20;
export const GRID_H = 20;
export const START_LEN = 4;
export const SCORE_PER_FOOD = 10;
export const MAX_TICKS = 60_000; // generous hard cap per run

export type Dir = 0 | 1 | 2 | 3; // 0=up 1=right 2=down 3=left
export interface Input { tick: number; dir: Dir; }
export interface Cell { x: number; y: number; }

export interface State {
  rng: number;        // current PRNG state (uint32)
  snake: Cell[];      // head at index 0
  dir: Dir;
  pendingDir: Dir;
  food: Cell;
  score: number;
  tick: number;
  alive: boolean;
  foodEaten: number;
}

export const OPPOSITE: Record<Dir, Dir> = { 0: 2, 1: 3, 2: 0, 3: 1 };
export const DX: Record<Dir, number> = { 0: 0, 1: 1, 2: 0, 3: -1 };
export const DY: Record<Dir, number> = { 0: -1, 1: 0, 2: 1, 3: 0 };

// mulberry32 — tiny, fast, fully deterministic uint32 PRNG.
function nextRand(state: number): { value: number; state: number } {
  let z = (state + 0x6d2b79f5) | 0;
  const s2 = z;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  const value = (z ^ (z >>> 14)) >>> 0; // uint32
  return { value, state: s2 };
}

function placeFood(s: State): void {
  // Deterministically choose an empty cell via the PRNG (no rejection sampling,
  // so the number of PRNG draws is fixed regardless of board state).
  const occupied = new Set(s.snake.map((c) => c.y * GRID_W + c.x));
  const free = GRID_W * GRID_H - occupied.size;
  if (free <= 0) { s.alive = false; return; }
  const r = nextRand(s.rng);
  s.rng = r.state;
  let idx = r.value % free;
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (occupied.has(y * GRID_W + x)) continue;
      if (idx === 0) { s.food = { x, y }; return; }
      idx--;
    }
  }
}

export function createState(seed: number): State {
  const s: State = {
    rng: seed >>> 0,
    snake: [],
    dir: 1,
    pendingDir: 1,
    food: { x: 0, y: 0 },
    score: 0,
    tick: 0,
    alive: true,
    foodEaten: 0,
  };
  const cy = GRID_H >> 1;
  const hx = GRID_W >> 1;
  for (let i = 0; i < START_LEN; i++) s.snake.push({ x: hx - i, y: cy }); // head first
  placeFood(s);
  return s;
}

export function setDir(s: State, dir: Dir): void {
  if (!s.alive) return;
  if (dir === OPPOSITE[s.dir]) return; // no 180-degree reversal
  s.pendingDir = dir;
}

export function step(s: State): void {
  if (!s.alive) return;
  s.dir = s.pendingDir;
  const head = s.snake[0]!; // invariant: the snake is never empty
  const nx = head.x + DX[s.dir];
  const ny = head.y + DY[s.dir];

  if (nx < 0 || ny < 0 || nx >= GRID_W || ny >= GRID_H) { s.alive = false; return; }

  const ate = nx === s.food.x && ny === s.food.y;
  // Tail vacates this tick unless we ate, so exclude it from the collision set.
  const body = ate ? s.snake : s.snake.slice(0, s.snake.length - 1);
  for (const c of body) {
    if (c.x === nx && c.y === ny) { s.alive = false; return; }
  }

  s.snake.unshift({ x: nx, y: ny });
  if (ate) {
    s.score += SCORE_PER_FOOD;
    s.foodEaten += 1;
    placeFood(s);
  } else {
    s.snake.pop();
  }
  s.tick += 1;
}

export interface RunResult { score: number; ticks: number; foodEaten: number; died: boolean; }

// AUTHORITATIVE REPLAY. The server trusts ONLY this output, never a client-claimed
// score. Inputs are sorted by tick (transit order is irrelevant) and stale inputs
// (tick already passed) are discarded so a malformed log can't stall the loop.
export function simulate(seed: number, inputs: Input[], maxTicks = MAX_TICKS): RunResult {
  const s = createState(seed);
  const ordered = [...inputs].sort((a, b) => a.tick - b.tick);
  let i = 0;
  while (s.alive && s.tick < maxTicks) {
    while (i < ordered.length && ordered[i]!.tick <= s.tick) {
      const inp = ordered[i]!;
      if (inp.tick === s.tick) setDir(s, inp.dir);
      i++; // discard stale (tick < current) inputs
    }
    step(s);
  }
  return { score: s.score, ticks: s.tick, foodEaten: s.foodEaten, died: !s.alive };
}
