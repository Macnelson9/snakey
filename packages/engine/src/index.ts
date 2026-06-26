// Public surface of the deterministic engine. The client render loop and the
// server replay verifier both import from here, guaranteeing a single source of
// truth for scoring. Keep this barrel in sync with engine.ts exports.
export {
  GRID_W,
  GRID_H,
  START_LEN,
  SCORE_PER_FOOD,
  MAX_TICKS,
  OPPOSITE,
  DX,
  DY,
  createState,
  setDir,
  step,
  simulate,
} from "./engine.ts";

export type { Dir, Input, Cell, State, RunResult } from "./engine.ts";
