// input.ts — map raw gestures/keys to an engine Dir. The 180°-reversal guard is
// NOT here: the engine's setDir already rejects reversals (single source of truth).
import type { Dir } from "@nokiadot/engine";

/** Dominant-axis swipe → Dir, or null below the distance threshold. */
export function swipeToDir(dx: number, dy: number, minSwipePx = 24): Dir | null {
  if (Math.abs(dx) < minSwipePx && Math.abs(dy) < minSwipePx) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0; // y grows downward on screen, matching engine DY
}

/** Arrow keys + WASD → Dir, or null. */
export function keyToDir(key: string): Dir | null {
  switch (key) {
    case "ArrowUp": case "w": case "W": return 0;
    case "ArrowRight": case "d": case "D": return 1;
    case "ArrowDown": case "s": case "S": return 2;
    case "ArrowLeft": case "a": case "A": return 3;
    default: return null;
  }
}
