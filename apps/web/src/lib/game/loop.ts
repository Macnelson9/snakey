// loop.ts — the client render-loop core, kept pure so it is unit-testable and so
// the input log it records replays to the identical score on the server. The
// React layer only calls advance() from rAF and reads state to draw.
import { createState, setDir, step, OPPOSITE, type Dir, type Input, type State } from "@nokiadot/engine";

export const MS_PER_TICK_BASE = 120;
export const MS_PER_TICK_FLOOR = 80;
const MS_RAMP_PER_FOOD = 4;

/** Tick interval shortens as the snake eats, down to a floor well above the
 *  server's 50ms plausibility gate. */
export function msPerTick(foodEaten: number): number {
  return Math.max(MS_PER_TICK_FLOOR, MS_PER_TICK_BASE - foodEaten * MS_RAMP_PER_FOOD);
}

export interface RunController {
  readonly state: State;
  readonly inputs: Input[];
  readonly alive: boolean;
  /** Apply a direction; records {tick,dir} iff the engine accepted a new turn. */
  queueDir(dir: Dir): void;
  /** Advance the engine for elapsed real ms; returns the number of ticks stepped. */
  advance(elapsedMs: number): number;
}

export function createRunController(seed: number): RunController {
  const state = createState(seed);
  const inputs: Input[] = [];
  let acc = 0;
  return {
    get state() { return state; },
    get inputs() { return inputs; },
    get alive() { return state.alive; },
    queueDir(dir) {
      // Prevent 180-degree reversal against pending direction
      if (dir === OPPOSITE[state.pendingDir]) return;
      const before = state.pendingDir;
      setDir(state, dir);
      if (state.pendingDir !== before) inputs.push({ tick: state.tick, dir: state.pendingDir });
    },
    advance(elapsedMs) {
      acc += elapsedMs;
      let stepped = 0;
      while (state.alive) {
        const interval = msPerTick(state.foodEaten);
        if (acc < interval) break;
        acc -= interval;
        step(state);
        stepped++;
      }
      return stepped;
    },
  };
}
