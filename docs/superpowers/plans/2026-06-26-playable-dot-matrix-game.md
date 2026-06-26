# Playable Dot-Matrix Game (Sub-project A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile-first PWA that renders the shared engine as playable Snake in a themeable dot-matrix aesthetic, wires the real `/session → play → /settle` round-trip with a placeholder player, and shows the server-authoritative score + earned G$.

**Architecture:** Pure TS modules (themes, preferences, input, loop, api, sfx) carry all testable logic and are covered by `node --test`. Thin React components render them; a `useGame` hook owns the `idle→playing→gameover` machine and the rAF loop. The LCD look is plain CSS driven by per-theme CSS variables. No wallet/chain code (sub-projects B/C).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, `@nokiadot/engine`, Web Audio, plain CSS, `node --test`.

## Global Constraints

- Test runner: `node --experimental-strip-types --disable-warning=ExperimentalWarning --test "src/**/*.test.ts"` run from `apps/web`. Import sibling modules with explicit `.ts` extensions (repo convention).
- The engine is the single source of truth for movement/scoring rules. Never re-implement the 180°-reversal guard or scoring on the client — call `setDir`/`step`. The engine stays untouched.
- Board is 20×20 (`GRID_W`/`GRID_H` from the engine). Engine `Dir`: `0=up 1=right 2=down 3=left`; screen Y grows downward (matches `DY`).
- Tick cadence floor is **80ms** and base **120ms** — both well above the server's 50ms plausibility gate, so honest play always passes.
- 8 themes, order `nokia, paper, ink, phosphor, amber, frost, bubblegum, tangerine`; **`nokia` is the default**.
- Preferences shape is exactly `{ theme: ThemeId; showDpad: boolean; sound: boolean }`, defaults `nokia / true / true`. localStorage keys: `nokiadot.prefs`, `nokiadot.hi`.
- The displayed result and earned amount come ONLY from `/settle` — never a client-side score claim.
- No Tailwind in A (plain CSS). No Privy/wallet/chain/GoodDollar code.

---

### Task 1: Theme registry

**Files:**
- Create: `apps/web/src/lib/ui/themes.ts`
- Test: `apps/web/src/lib/ui/themes.test.ts`

**Interfaces:**
- Produces: `ThemeId` (union of the 8 ids); `ThemeTokens = { frame; board; ghost; lit; food; hud; litShadow?; foodShadow? }` (all strings); `THEMES: Record<ThemeId, ThemeTokens>`; `THEME_ORDER: ThemeId[]`; `DEFAULT_THEME: ThemeId`; `themeVars(t: ThemeTokens): Record<string,string>`.

- [ ] **Step 1: Write the failing test** — `themes.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, THEME_ORDER, DEFAULT_THEME, themeVars, type ThemeId } from "./themes.ts";

const REQUIRED = ["frame", "board", "ghost", "lit", "food", "hud"] as const;

test("every theme in THEME_ORDER defines every required token", () => {
  assert.equal(THEME_ORDER.length, 8);
  for (const id of THEME_ORDER) {
    const t = THEMES[id];
    assert.ok(t, `missing theme ${id}`);
    for (const k of REQUIRED) assert.equal(typeof (t as Record<string, unknown>)[k], "string", `${id}.${k}`);
  }
});

test("THEME_ORDER and THEMES keys match exactly", () => {
  assert.deepEqual([...THEME_ORDER].sort(), (Object.keys(THEMES) as ThemeId[]).sort());
});

test("nokia is the default and is a known theme", () => {
  assert.equal(DEFAULT_THEME, "nokia");
  assert.ok(THEMES[DEFAULT_THEME]);
});

test("themeVars maps tokens to CSS custom properties with shadow fallbacks", () => {
  const v = themeVars(THEMES.nokia);
  assert.equal(v["--frame"], THEMES.nokia.frame);
  assert.equal(v["--lit"], THEMES.nokia.lit);
  assert.equal(v["--lit-shadow"], "none"); // nokia has no glow
  assert.equal(v["--food-shadow"], "inset 0 0 0 1.2px var(--board)");
  const g = themeVars(THEMES.phosphor);
  assert.ok(g["--lit-shadow"].includes("0 0")); // phosphor glows
});
```

- [ ] **Step 2: Run, verify it fails** — `npm test` from `apps/web`. Expected: cannot find `./themes.ts`.
- [ ] **Step 3: Implement `themes.ts`:**

```ts
// themes.ts — the dot-matrix theme registry. Each theme is a small token set; the
// board/HUD read these as CSS custom properties, so switching themes is a pure
// variable swap. Adding a theme is one entry here (+ its id in THEME_ORDER).
export type ThemeId =
  | "nokia" | "paper" | "ink" | "phosphor"
  | "amber" | "frost" | "bubblegum" | "tangerine";

export interface ThemeTokens {
  frame: string; board: string; ghost: string; lit: string;
  food: string; hud: string; litShadow?: string; foodShadow?: string;
}

export const THEMES: Record<ThemeId, ThemeTokens> = {
  nokia:     { frame: "#aebb8e", board: "#b9c79a", ghost: "#aebb8e", lit: "#2b3318", food: "#2b3318", hud: "#2b3318" },
  paper:     { frame: "#e7e4d8", board: "#dedbcd", ghost: "#d6d3c4", lit: "#17150f", food: "#17150f", hud: "#17150f" },
  ink:       { frame: "#0a0a0a", board: "#121212", ghost: "#1f1f1f", lit: "#f2f2ea", food: "#ffffff", hud: "#e8e8e0" },
  phosphor:  { frame: "#0c0f0a", board: "#0e130c", ghost: "#161d12", lit: "#a9e35c", food: "#e7f3c8", hud: "#9fd45f", litShadow: "0 0 3px #a9e35c88", foodShadow: "0 0 5px #cfee88" },
  amber:     { frame: "#100a02", board: "#150d03", ghost: "#241a0a", lit: "#f5a623", food: "#ffd591", hud: "#f5a623", litShadow: "0 0 3px #f5a62388", foodShadow: "0 0 5px #ffd591" },
  frost:     { frame: "#06101c", board: "#081424", ghost: "#102236", lit: "#5fd0ff", food: "#cdeeff", hud: "#7fd8ff", litShadow: "0 0 3px #5fd0ff88", foodShadow: "0 0 5px #cdeeff" },
  bubblegum: { frame: "#f7d9e6", board: "#f2c9db", ghost: "#ecbcd0", lit: "#b3164f", food: "#b3164f", hud: "#8e0f3e" },
  tangerine: { frame: "#f3c69a", board: "#efbd8a", ghost: "#e8b07a", lit: "#5a2a06", food: "#5a2a06", hud: "#5a2a06" },
};

export const THEME_ORDER: ThemeId[] = [
  "nokia", "paper", "ink", "phosphor", "amber", "frost", "bubblegum", "tangerine",
];

export const DEFAULT_THEME: ThemeId = "nokia";

/** Map a theme's tokens to the CSS custom properties the board/HUD consume. */
export function themeVars(t: ThemeTokens): Record<string, string> {
  return {
    "--frame": t.frame, "--board": t.board, "--ghost": t.ghost,
    "--lit": t.lit, "--food": t.food, "--hud": t.hud,
    "--lit-shadow": t.litShadow ?? "none",
    "--food-shadow": t.foodShadow ?? "inset 0 0 0 1.2px var(--board)",
  };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(web): dot-matrix theme registry (8 themes)`.

### Task 2: Preferences (pure)

**Files:**
- Create: `apps/web/src/lib/ui/preferences.ts`
- Test: `apps/web/src/lib/ui/preferences.test.ts`

**Interfaces:**
- Consumes: `ThemeId`, `THEMES`, `DEFAULT_THEME` (Task 1).
- Produces: `Preferences = { theme: ThemeId; showDpad: boolean; sound: boolean }`; `DEFAULT_PREFERENCES`; `loadPreferences(raw: unknown): Preferences`; `serializePreferences(p): string`.

- [ ] **Step 1: Write the failing test:**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadPreferences, serializePreferences, DEFAULT_PREFERENCES } from "./preferences.ts";

test("defaults are nokia / dpad on / sound on", () => {
  assert.deepEqual(DEFAULT_PREFERENCES, { theme: "nokia", showDpad: true, sound: true });
});

test("loadPreferences returns defaults for junk", () => {
  assert.deepEqual(loadPreferences(null), DEFAULT_PREFERENCES);
  assert.deepEqual(loadPreferences("nope"), DEFAULT_PREFERENCES);
  assert.deepEqual(loadPreferences({}), DEFAULT_PREFERENCES);
});

test("loadPreferences keeps valid fields and clamps unknown theme to default", () => {
  assert.deepEqual(loadPreferences({ theme: "frost", showDpad: false, sound: false }),
    { theme: "frost", showDpad: false, sound: false });
  assert.equal(loadPreferences({ theme: "rainbow" }).theme, "nokia");
  assert.equal(loadPreferences({ showDpad: "yes" }).showDpad, true); // non-bool -> default
});

test("serialize round-trips through load", () => {
  const p = { theme: "amber", showDpad: false, sound: true } as const;
  assert.deepEqual(loadPreferences(JSON.parse(serializePreferences(p))), p);
});
```

- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement `preferences.ts`:**

```ts
// preferences.ts — player settings (theme, control + sound prefs). Pure parse so
// it is unit-testable; the React provider wraps localStorage I/O around this.
import { DEFAULT_THEME, THEMES, type ThemeId } from "./themes.ts";

export interface Preferences {
  theme: ThemeId;
  showDpad: boolean;
  sound: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: DEFAULT_THEME, showDpad: true, sound: true,
};

/** Tolerant parse: unknown/partial input falls back per-field to the default. */
export function loadPreferences(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_PREFERENCES };
  const o = raw as Record<string, unknown>;
  return {
    theme: typeof o.theme === "string" && o.theme in THEMES ? (o.theme as ThemeId) : DEFAULT_PREFERENCES.theme,
    showDpad: typeof o.showDpad === "boolean" ? o.showDpad : DEFAULT_PREFERENCES.showDpad,
    sound: typeof o.sound === "boolean" ? o.sound : DEFAULT_PREFERENCES.sound,
  };
}

export function serializePreferences(p: Preferences): string {
  return JSON.stringify(p);
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(web): player preferences (theme/dpad/sound)`.

### Task 3: Input resolvers

**Files:**
- Create: `apps/web/src/lib/game/input.ts`
- Test: `apps/web/src/lib/game/input.test.ts`

**Interfaces:**
- Produces: `swipeToDir(dx: number, dy: number, minSwipePx?: number): Dir | null`; `keyToDir(key: string): Dir | null`.

- [ ] **Step 1: Write the failing test:**

```ts
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
```

- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement `input.ts`:**

```ts
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
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(web): swipe/keyboard input resolvers`.

### Task 4: Game loop + RunController

**Files:**
- Create: `apps/web/src/lib/game/loop.ts`
- Test: `apps/web/src/lib/game/loop.test.ts`

**Interfaces:**
- Consumes: engine `createState/setDir/step/simulate`, `Dir`, `Input`, `State`.
- Produces: `MS_PER_TICK_BASE`, `MS_PER_TICK_FLOOR`, `msPerTick(foodEaten: number): number`; `RunController = { state: State; inputs: Input[]; alive: boolean; queueDir(dir: Dir): void; advance(elapsedMs: number): number }`; `createRunController(seed: number): RunController`.

- [ ] **Step 1: Write the failing test:**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, type Dir } from "@nokiadot/engine";
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
  c.queueDir(2); // down is a 180 from up -> engine rejects, no log
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
```

- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement `loop.ts`:**

```ts
// loop.ts — the client render-loop core, kept pure so it is unit-testable and so
// the input log it records replays to the identical score on the server. The
// React layer only calls advance() from rAF and reads state to draw.
import { createState, setDir, step, type Dir, type Input, type State } from "@nokiadot/engine";

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
```

- [ ] **Step 4: Run, verify pass.** (The determinism test is the key one — it proves the client log and the server replay agree.)
- [ ] **Step 5: Commit** — `feat(web): pure run controller + speed ramp`.

### Task 5: Front-end API client

**Files:**
- Create: `apps/web/src/lib/client/api.ts`
- Test: `apps/web/src/lib/client/api.test.ts`

**Interfaces:**
- Produces: `PLACEHOLDER_PLAYER`; `SessionResponse = { runId: string; seed: number; issuedAt: number }`; `SettleResponse` (mirrors the server `SerializedSettle` union); `createSession(player, fetchImpl?)`; `submitRun(runId, inputs, fetchImpl?)`.

- [ ] **Step 1: Write the failing test:**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, submitRun, PLACEHOLDER_PLAYER } from "./api.ts";

function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, reqInit: RequestInit) => {
    calls.push({ url, init: reqInit });
    return { ok: init.ok ?? true, status: init.status ?? 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

test("createSession POSTs the player to /api/session", async () => {
  const { fn, calls } = stubFetch({ runId: "0x1", seed: 7, issuedAt: 1 }, { status: 201 });
  const out = await createSession(PLACEHOLDER_PLAYER, fn);
  assert.equal(out.seed, 7);
  assert.equal(calls[0]!.url, "/api/session");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { player: PLACEHOLDER_PLAYER });
});

test("submitRun POSTs runId+inputs and returns the settle body even on 409", async () => {
  const { fn, calls } = stubFetch({ status: "rejected", reason: "replay" }, { ok: false, status: 409 });
  const out = await submitRun("0xrun", [{ tick: 0, dir: 1 }], fn);
  assert.equal(out.status, "rejected");
  assert.equal(calls[0]!.url, "/api/settle");
  assert.deepEqual(JSON.parse(calls[0]!.init.body as string), { runId: "0xrun", inputs: [{ tick: 0, dir: 1 }] });
});
```

- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement `api.ts`:**

```ts
// api.ts — typed browser client for the score-integrity backend. fetch is
// injectable so request shaping is unit-testable. The player address is a
// TEMP placeholder until sub-project B supplies a real Privy wallet.
import type { Address } from "viem";
import type { Input } from "@nokiadot/engine";

// TEMP: replaced by the Privy player address in sub-project B.
export const PLACEHOLDER_PLAYER = "0x000000000000000000000000000000000000dEaD" as Address;

export interface SessionResponse { runId: string; seed: number; issuedAt: number; }

interface SettleVoucher { player: string; runId: string; amount: string; deadline: string; }
export type SettleResponse =
  | { status: "accepted"; score: number; ticks: number; foodEaten: number; died: boolean; amount: string; flagged: boolean; flags: string[]; signer: string; signature: string; voucher: SettleVoucher }
  | { status: "no_reward"; reason: "below_bar" | "cap_reached" | "not_verified"; score: number; ticks: number; amount: string }
  | { status: "rejected"; reason: "invalid_input" | "unknown_session" | "replay" | "implausible_timing" };

type FetchImpl = typeof fetch;

export async function createSession(player: Address, fetchImpl: FetchImpl = fetch): Promise<SessionResponse> {
  const res = await fetchImpl("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ player }),
  });
  if (!res.ok) throw new Error(`/api/session failed: ${res.status}`);
  return res.json() as Promise<SessionResponse>;
}

export async function submitRun(runId: string, inputs: Input[], fetchImpl: FetchImpl = fetch): Promise<SettleResponse> {
  // 200/404/409 all carry a settle body; rejected outcomes are not thrown.
  const res = await fetchImpl("/api/settle", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ runId, inputs }),
  });
  return res.json() as Promise<SettleResponse>;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(web): typed front-end session/settle client`.

### Task 6: Sound effects

**Files:**
- Create: `apps/web/src/lib/audio/sfx.ts`
- Test: `apps/web/src/lib/audio/sfx.test.ts`

**Interfaces:**
- Produces: `SfxName = "eat"|"die"|"highscore"|"start"|"tap"`; `CUES: Record<SfxName, Cue>`; `Sfx = { unlock(): void; play(name: SfxName): void; setEnabled(b: boolean): void }`; `createSfx(enabled?: boolean): Sfx`.

- [ ] **Step 1: Write the failing test:**

```ts
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
```

- [ ] **Step 2: Run, verify it fails.**
- [ ] **Step 3: Implement `sfx.ts`:**

```ts
// sfx.ts — tiny Web Audio synth (square-wave beeps, monophonic Nokia feel). No
// audio assets, so the PWA stays light and works offline. Degrades to a no-op
// where Web Audio is unavailable (SSR/node) or sound is disabled.
export type SfxName = "eat" | "die" | "highscore" | "start" | "tap";
interface Step { freq: number; ms: number; }
interface Cue { type: OscillatorType; gain: number; steps: Step[]; }

export const CUES: Record<SfxName, Cue> = {
  eat:       { type: "square", gain: 0.08, steps: [{ freq: 880, ms: 60 }] },
  tap:       { type: "square", gain: 0.05, steps: [{ freq: 440, ms: 30 }] },
  start:     { type: "square", gain: 0.07, steps: [{ freq: 523, ms: 70 }, { freq: 784, ms: 90 }] },
  die:       { type: "square", gain: 0.09, steps: [{ freq: 300, ms: 90 }, { freq: 200, ms: 110 }, { freq: 120, ms: 160 }] },
  highscore: { type: "square", gain: 0.08, steps: [{ freq: 523, ms: 80 }, { freq: 659, ms: 80 }, { freq: 784, ms: 80 }, { freq: 1047, ms: 150 }] },
};

export interface Sfx { unlock(): void; play(name: SfxName): void; setEnabled(b: boolean): void; }

export function createSfx(enabled = true): Sfx {
  let on = enabled;
  let ctx: AudioContext | undefined;
  const AC: typeof AudioContext | undefined =
    typeof window !== "undefined"
      ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
      : undefined;

  function ensure(): AudioContext | undefined {
    if (!AC) return undefined;
    if (!ctx) ctx = new AC();
    return ctx;
  }

  return {
    setEnabled(b) { on = b; },
    unlock() { const c = ensure(); if (c && c.state === "suspended") void c.resume(); },
    play(name) {
      if (!on) return;
      const c = ensure();
      if (!c) return;
      const cue = CUES[name];
      let t = c.currentTime;
      for (const s of cue.steps) {
        const osc = c.createOscillator();
        const g = c.createGain();
        osc.type = cue.type;
        osc.frequency.value = s.freq;
        g.gain.setValueAtTime(cue.gain, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + s.ms / 1000);
        osc.connect(g);
        g.connect(c.destination);
        osc.start(t);
        osc.stop(t + s.ms / 1000);
        t += s.ms / 1000;
      }
    },
  };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `feat(web): web-audio sfx engine`.

### Task 7: Global CSS + theme provider + Board + Hud

**Files:**
- Create: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/PreferencesProvider.tsx`
- Create: `apps/web/src/components/Board.tsx`
- Create: `apps/web/src/components/Hud.tsx`
- Modify: `apps/web/src/app/layout.tsx` (import globals.css)

**Interfaces:**
- Consumes: `themes` + `preferences` (Tasks 1–2); engine `GRID_W`, `State`.
- Produces: `usePreferences()` → `{ prefs, setPrefs }`; `<PreferencesProvider>`; `<Board state>`; `<Hud score hi onOpenSettings>`.

- [ ] **Step 1: Create `globals.css`** (the LCD look + layout; all colors come from theme vars):

```css
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: #111; }
body { font-family: "DejaVu Sans Mono", ui-monospace, Menlo, Consolas, monospace; -webkit-user-select: none; user-select: none; }
.app { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 12px; }
.device { width: 100%; max-width: 420px; background: var(--frame); border-radius: 26px; padding: 16px 14px 18px; box-shadow: 0 10px 40px #0008; touch-action: none; }
.hud { display: flex; align-items: center; justify-content: space-between; color: var(--hud); margin-bottom: 10px; }
.wordmark { font-size: 15px; font-weight: 700; letter-spacing: .16em; }
.hud-right { display: flex; align-items: center; gap: 10px; }
.score-row { display: flex; justify-content: space-between; color: var(--hud); font-size: 12px; letter-spacing: .12em; font-variant-numeric: tabular-nums; margin-bottom: 10px; }
.score-row b { font-size: 17px; }
.theme-btn { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--hud); cursor: pointer; background: conic-gradient(#2b3318, #a9e35c, #5fd0ff, #b3164f, #f5a623, #2b3318); }
.board { display: grid; grid-template-columns: repeat(20, 1fr); gap: 1px; width: 100%; aspect-ratio: 1 / 1; padding: 6px; border-radius: 4px; background: var(--board); }
.px { border-radius: 1.5px; background: var(--ghost); }
.px.on { background: var(--lit); box-shadow: var(--lit-shadow); }
.px.food { background: var(--food); box-shadow: var(--food-shadow); }
.controls { margin-top: 14px; min-height: 120px; display: flex; align-items: center; justify-content: center; }
.dpad { display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(3, 44px); gap: 6px; }
.dpad button { background: color-mix(in srgb, var(--board) 70%, var(--hud) 12%); color: var(--lit); border: none; border-radius: 8px; font-size: 18px; box-shadow: inset 0 -3px 0 #0003; cursor: pointer; }
.dpad .up { grid-area: 1/2 } .dpad .left { grid-area: 2/1 } .dpad .right { grid-area: 2/3 } .dpad .down { grid-area: 3/2 }
.btn { font-family: inherit; background: var(--lit); color: var(--frame); border: none; border-radius: 8px; padding: 12px 18px; font-size: 14px; letter-spacing: .1em; cursor: pointer; }
.overlay { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; background: color-mix(in srgb, var(--frame) 86%, transparent); border-radius: 4px; color: var(--hud); text-align: center; padding: 16px; }
.board-wrap { position: relative; }
.sheet-backdrop { position: fixed; inset: 0; background: #0007; display: flex; align-items: flex-end; justify-content: center; }
.sheet { width: 100%; max-width: 420px; background: var(--frame); color: var(--hud); border-radius: 18px 18px 0 0; padding: 16px; }
.theme-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 10px 0 16px; }
.theme-swatch { border-radius: 8px; padding: 6px; border: 2px solid transparent; cursor: pointer; }
.theme-swatch.active { border-color: var(--hud); }
.toggle-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 2px; font-size: 13px; letter-spacing: .08em; }
```

- [ ] **Step 2: Create `PreferencesProvider.tsx`:**

```tsx
"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PREFERENCES, loadPreferences, serializePreferences, type Preferences } from "@/lib/ui/preferences.ts";

const KEY = "nokiadot.prefs";
const Ctx = createContext<{ prefs: Preferences; setPrefs: (p: Preferences) => void } | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<Preferences>(DEFAULT_PREFERENCES);
  useEffect(() => {
    try { setPrefsState(loadPreferences(JSON.parse(localStorage.getItem(KEY) ?? "null"))); } catch { /* defaults */ }
  }, []);
  const setPrefs = (p: Preferences) => {
    setPrefsState(p);
    try { localStorage.setItem(KEY, serializePreferences(p)); } catch { /* ignore */ }
  };
  return <Ctx.Provider value={{ prefs, setPrefs }}>{children}</Ctx.Provider>;
}

export function usePreferences() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePreferences must be used within PreferencesProvider");
  return v;
}
```

- [ ] **Step 3: Create `Board.tsx`:**

```tsx
import { GRID_W, GRID_H, type State } from "@nokiadot/engine";

export function Board({ state }: { state: State }) {
  const lit = new Set(state.snake.map((c) => c.y * GRID_W + c.x));
  const foodKey = state.food.y * GRID_W + state.food.x;
  const cells = [];
  for (let i = 0; i < GRID_W * GRID_H; i++) {
    const cls = "px" + (lit.has(i) ? " on" : "") + (i === foodKey ? " food" : "");
    cells.push(<div key={i} className={cls} />);
  }
  return <div className="board">{cells}</div>;
}
```

- [ ] **Step 4: Create `Hud.tsx`:**

```tsx
export function Hud({ score, hi, onOpenSettings }: { score: number; hi: number; onOpenSettings: () => void }) {
  return (
    <>
      <div className="hud">
        <span className="wordmark">NOKIADOT</span>
        <div className="hud-right">
          <button className="theme-btn" aria-label="Settings" onClick={onOpenSettings} />
        </div>
      </div>
      <div className="score-row">
        <span>SCORE <b>{score}</b></span>
        <span>HI <b>{hi}</b></span>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Modify `layout.tsx`** — add `import "./globals.css";` as the first line (keep the existing metadata/viewport/body).
- [ ] **Step 6: Verify** — from `apps/web`: `npx tsc --noEmit` clean and `npx next build` compiles.
- [ ] **Step 7: Commit** — `feat(web): global LCD styles, theme provider, board + hud`.

### Task 8: D-pad, settings sheet, game overlay

**Files:**
- Create: `apps/web/src/components/Dpad.tsx`
- Create: `apps/web/src/components/SettingsSheet.tsx`
- Create: `apps/web/src/components/GameOverlay.tsx`

**Interfaces:**
- Consumes: `usePreferences` (Task 7); `THEMES`/`THEME_ORDER`/`themeVars` (Task 1); `SettleResponse` (Task 5); engine `Dir`.
- Produces: `<Dpad onDir>`; `<SettingsSheet open onClose>`; `<GameOverlay phase result onStart>`.

- [ ] **Step 1: Create `Dpad.tsx`:**

```tsx
import type { Dir } from "@nokiadot/engine";

export function Dpad({ onDir }: { onDir: (d: Dir) => void }) {
  return (
    <div className="dpad">
      <button className="up" aria-label="Up" onClick={() => onDir(0)}>▲</button>
      <button className="left" aria-label="Left" onClick={() => onDir(3)}>◀</button>
      <button className="right" aria-label="Right" onClick={() => onDir(1)}>▶</button>
      <button className="down" aria-label="Down" onClick={() => onDir(2)}>▼</button>
    </div>
  );
}
```

- [ ] **Step 2: Create `SettingsSheet.tsx`** (theme grid + dpad/sound toggles, persisted via `usePreferences`):

```tsx
"use client";
import { usePreferences } from "./PreferencesProvider.tsx";
import { THEMES, THEME_ORDER, themeVars } from "@/lib/ui/themes.ts";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, setPrefs } = usePreferences();
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="toggle-row"><b>THEME</b><button className="btn" onClick={onClose}>DONE</button></div>
        <div className="theme-grid">
          {THEME_ORDER.map((id) => (
            <div
              key={id}
              className={"theme-swatch" + (prefs.theme === id ? " active" : "")}
              style={themeVars(THEMES[id])}
              onClick={() => setPrefs({ ...prefs, theme: id })}
            >
              <div className="board" style={{ gridTemplateColumns: "repeat(6,1fr)", gap: 1, padding: 3 }}>
                {Array.from({ length: 36 }, (_, i) => (
                  <div key={i} className={"px" + (i === 14 || i === 15 || i === 21 ? " on" : "") + (i === 9 ? " food" : "")} />
                ))}
              </div>
              <div style={{ fontSize: 9, textAlign: "center", marginTop: 4 }}>{id.toUpperCase()}</div>
            </div>
          ))}
        </div>
        <div className="toggle-row">
          <span>SHOW D-PAD</span>
          <button className="btn" onClick={() => setPrefs({ ...prefs, showDpad: !prefs.showDpad })}>{prefs.showDpad ? "ON" : "OFF"}</button>
        </div>
        <div className="toggle-row">
          <span>SOUND</span>
          <button className="btn" onClick={() => setPrefs({ ...prefs, sound: !prefs.sound })}>{prefs.sound ? "ON" : "OFF"}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `GameOverlay.tsx`** (start + game-over; shows authoritative result):

```tsx
import type { SettleResponse } from "@/lib/client/api.ts";

function gd(amountWei: string): string {
  // 18-decimal wei -> short G$ string, integer math so no float drift.
  const w = BigInt(amountWei);
  const whole = w / 10n ** 18n;
  const frac = (w % 10n ** 18n) / 10n ** 16n; // 2 dp
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

export function GameOverlay({
  phase, result, practice, onStart,
}: { phase: "idle" | "gameover"; result: SettleResponse | null; practice: boolean; onStart: () => void }) {
  if (phase === "idle") {
    return (
      <div className="overlay">
        <div className="wordmark" style={{ fontSize: 22 }}>NOKIADOT</div>
        <p style={{ fontSize: 12, opacity: .8 }}>swipe / arrows to steer · eat the dot</p>
        <button className="btn" onClick={onStart}>PLAY</button>
      </div>
    );
  }
  return (
    <div className="overlay">
      <div style={{ fontSize: 14, letterSpacing: ".1em" }}>GAME OVER</div>
      {result?.status === "accepted" && (
        <div><div style={{ fontSize: 28 }}>{result.score}</div><div style={{ fontSize: 12 }}>earned {gd(result.amount)} G$</div></div>
      )}
      {result?.status === "no_reward" && (
        <div><div style={{ fontSize: 28 }}>{result.score}</div><div style={{ fontSize: 12 }}>{
          result.reason === "below_bar" ? "below the reward bar" :
          result.reason === "not_verified" ? "verify to earn (later)" : "daily cap reached"
        }</div></div>
      )}
      {result?.status === "rejected" && <div style={{ fontSize: 12 }}>run not counted: {result.reason}</div>}
      {practice && <div style={{ fontSize: 11, opacity: .7 }}>practice mode — offline</div>}
      <button className="btn" onClick={onStart}>PLAY AGAIN</button>
    </div>
  );
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean, `npx next build` compiles.
- [ ] **Step 5: Commit** — `feat(web): dpad, settings sheet, game overlay`.

### Task 9: useGame hook + page wiring

**Files:**
- Create: `apps/web/src/components/useGame.ts`
- Modify: `apps/web/src/app/page.tsx` (assemble the screen)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: `useGame()` → `{ phase, state, liveScore, hi, result, practice, start, queueDir }`; the assembled game screen at `/`.

- [ ] **Step 1: Create `useGame.ts`** (the state machine + rAF loop + session/settle + SFX):

```ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dir, State } from "@nokiadot/engine";
import { createRunController, type RunController } from "@/lib/game/loop.ts";
import { keyToDir } from "@/lib/game/input.ts";
import { createSession, submitRun, PLACEHOLDER_PLAYER, type SettleResponse } from "@/lib/client/api.ts";
import { createSfx } from "@/lib/audio/sfx.ts";
import { usePreferences } from "./PreferencesProvider.tsx";

const HI_KEY = "nokiadot.hi";
type Phase = "idle" | "playing" | "gameover";

export function useGame() {
  const { prefs } = usePreferences();
  const sfx = useMemo(() => createSfx(prefs.sound), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { sfx.setEnabled(prefs.sound); }, [prefs.sound, sfx]);

  const [phase, setPhase] = useState<Phase>("idle");
  const [, force] = useState(0);
  const [result, setResult] = useState<SettleResponse | null>(null);
  const [practice, setPractice] = useState(false);
  const [hi, setHi] = useState(0);
  useEffect(() => { setHi(Number(localStorage.getItem(HI_KEY) ?? 0) || 0); }, []);

  const ctl = useRef<RunController | null>(null);
  const runId = useRef<string | null>(null);
  const raf = useRef<number | null>(null);
  const last = useRef(0);

  const endRun = useCallback(async () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    sfx.play("die");
    setPhase("gameover");
    const c = ctl.current!;
    if (practice || !runId.current) {
      setResult({ status: "no_reward", reason: "below_bar", score: c.state.score, ticks: c.state.tick, amount: "0" });
    } else {
      try {
        const r = await submitRun(runId.current, c.inputs);
        setResult(r);
        if (r.status === "accepted" && r.score > hi) { setHi(r.score); localStorage.setItem(HI_KEY, String(r.score)); sfx.play("highscore"); }
      } catch {
        setResult({ status: "rejected", reason: "unknown_session" });
      }
    }
  }, [practice, hi, sfx]);

  const tick = useCallback((ts: number) => {
    const c = ctl.current!;
    const dt = ts - last.current; last.current = ts;
    const before = c.state.foodEaten;
    c.advance(dt);
    if (c.state.foodEaten > before) sfx.play("eat");
    force((n) => n + 1);
    if (!c.alive) { void endRun(); return; }
    raf.current = requestAnimationFrame(tick);
  }, [endRun, sfx]);

  const start = useCallback(async () => {
    sfx.unlock(); sfx.play("start");
    setResult(null);
    let seed: number;
    if (typeof navigator !== "undefined" && navigator.onLine) {
      try { const s = await createSession(PLACEHOLDER_PLAYER); seed = s.seed; runId.current = s.runId; setPractice(false); }
      catch { seed = (Math.random() * 0xffffffff) >>> 0; runId.current = null; setPractice(true); }
    } else { seed = (Math.random() * 0xffffffff) >>> 0; runId.current = null; setPractice(true); }
    ctl.current = createRunController(seed);
    setPhase("playing");
    last.current = performance.now();
    raf.current = requestAnimationFrame(tick);
  }, [sfx, tick]);

  const queueDir = useCallback((d: Dir) => { ctl.current?.queueDir(d); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const d = keyToDir(e.key); if (d !== null) { e.preventDefault(); queueDir(d); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queueDir]);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  const state: State | null = ctl.current?.state ?? null;
  return { phase, state, liveScore: state?.score ?? 0, hi, result, practice, start, queueDir };
}
```

- [ ] **Step 2: Replace `page.tsx`** with the assembled screen (theme wrapper, swipe handling, board, controls, overlays):

```tsx
"use client";
import { useRef, useState } from "react";
import { GRID_W, GRID_H, createState, type State } from "@nokiadot/engine";
import { PreferencesProvider, usePreferences } from "@/components/PreferencesProvider.tsx";
import { THEMES, themeVars } from "@/lib/ui/themes.ts";
import { swipeToDir } from "@/lib/game/input.ts";
import { Board } from "@/components/Board.tsx";
import { Hud } from "@/components/Hud.tsx";
import { Dpad } from "@/components/Dpad.tsx";
import { SettingsSheet } from "@/components/SettingsSheet.tsx";
import { GameOverlay } from "@/components/GameOverlay.tsx";
import { useGame } from "@/components/useGame.ts";

const IDLE_BOARD: State = createState(0xc0ffee); // a static board behind the start overlay

function Screen() {
  const { prefs } = usePreferences();
  const game = useGame();
  const [settings, setSettings] = useState(false);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const shown = game.state ?? IDLE_BOARD;

  return (
    <div className="app" style={themeVars(THEMES[prefs.theme])}>
      <div className="device">
        <Hud score={game.liveScore} hi={game.hi} onOpenSettings={() => setSettings(true)} />
        <div
          className="board-wrap"
          onTouchStart={(e) => { const t = e.changedTouches[0]!; touch.current = { x: t.clientX, y: t.clientY }; }}
          onTouchEnd={(e) => {
            if (!touch.current) return;
            const t = e.changedTouches[0]!;
            const d = swipeToDir(t.clientX - touch.current.x, t.clientY - touch.current.y);
            if (d !== null) game.queueDir(d);
            touch.current = null;
          }}
        >
          <Board state={shown} />
          {game.phase !== "playing" && (
            <GameOverlay phase={game.phase === "idle" ? "idle" : "gameover"} result={game.result} practice={game.practice} onStart={game.start} />
          )}
        </div>
        <div className="controls">{prefs.showDpad && <Dpad onDir={game.queueDir} />}</div>
      </div>
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}

export default function Home() {
  return (
    <PreferencesProvider>
      <Screen />
    </PreferencesProvider>
  );
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` clean, `npx next build` compiles. Then `npm test` (all pure-module suites still green).
- [ ] **Step 4: Manual play checklist** (`npm run dev`): start → snake moves, swipe + dpad + arrows steer, eating beeps and grows, death beeps + shows authoritative score & earned G$, Play Again works, theme switch repaints instantly and persists across reload, D-pad/sound toggles persist, HI updates.
- [ ] **Step 5: Commit** — `feat(web): wire the playable game loop end-to-end`.

### Task 10: PWA shell (manifest, icon, service worker)

**Files:**
- Create: `apps/web/src/app/manifest.ts`
- Create: `apps/web/public/icon.svg`
- Create: `apps/web/public/sw.js`
- Create: `apps/web/src/components/RegisterSW.tsx`
- Modify: `apps/web/src/app/layout.tsx` (mount `RegisterSW`, set viewport)

**Interfaces:**
- Produces: an installable manifest, an app-shell service worker, and its registration.

- [ ] **Step 1: Create `app/manifest.ts`:**

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nokiadot",
    short_name: "Nokiadot",
    description: "Nostalgic Snake on Celo. Play instantly, earn G$.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
```

- [ ] **Step 2: Create `public/icon.svg`** (a simple dot-matrix mark — no binary assets):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#aebb8e"/>
  <g fill="#2b3318">
    <rect x="128" y="224" width="56" height="56" rx="8"/>
    <rect x="192" y="224" width="56" height="56" rx="8"/>
    <rect x="256" y="224" width="56" height="56" rx="8"/>
    <rect x="256" y="288" width="56" height="56" rx="8"/>
    <rect x="320" y="160" width="56" height="56" rx="8"/>
  </g>
</svg>
```

- [ ] **Step 3: Create `public/sw.js`** (cache-first app shell so offline practice works):

```js
const CACHE = "nokiadot-shell-v1";
const SHELL = ["/"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // never cache the score API
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit || fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("/"))
    )
  );
});
```

- [ ] **Step 4: Create `RegisterSW.tsx`:**

```tsx
"use client";
import { useEffect } from "react";

export function RegisterSW() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* best-effort */ });
    }
  }, []);
  return null;
}
```

- [ ] **Step 5: Modify `layout.tsx`** — keep `import "./globals.css";`; mount `<RegisterSW />` inside `<body>` alongside `{children}`; extend the viewport so the board owns gestures:

```tsx
export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};
```

- [ ] **Step 6: Verify** — `npx next build` compiles; in `npm run dev` the manifest serves at `/manifest.webmanifest`, the SW registers (DevTools → Application), and a second load while offline still renders the shell (start screen) for practice.
- [ ] **Step 7: Commit** — `feat(web): installable PWA shell + offline app cache`.

---

## Self-Review

- **Spec coverage:** theme system (T1) · preferences incl. sound (T2) · swipe/keyboard (T3) · loop + ramp + determinism (T4) · /session+/settle client with placeholder (T5) · SFX set (T6) · board/HUD/theme application (T7) · D-pad + settings + overlays (T8) · state machine + offline practice + wiring (T9) · PWA shell (T10). All spec sections map to a task.
- **No placeholders:** every step ships real code; `PLACEHOLDER_PLAYER` and `IDLE_BOARD` are intentional named constants, not gaps.
- **Type consistency:** `Preferences{theme,showDpad,sound}`, `RunController{state,inputs,alive,queueDir,advance}`, `SettleResponse` union, `themeVars` keys (`--lit-shadow`/`--food-shadow`) match across producer and consumer tasks.
- **Engine purity:** no task edits `packages/engine`; the 180° guard and scoring are only ever reached through `setDir`/`step`/`simulate`.
```
