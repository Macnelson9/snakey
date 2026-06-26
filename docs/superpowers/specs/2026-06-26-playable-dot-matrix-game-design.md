# Playable Dot-Matrix Game (Sub-project A) — Design Spec

> Milestone #4 from `claude.md` is decomposed into three independently-shippable
> sub-projects: **A — the playable dot-matrix game** (this spec), **B — Privy
> wallet layer**, **C — claim / GoodDollar verify / on-chain redeem**. A is the
> heart and the only one with no external blockers (no Privy App ID, no deployed
> contract). B and C are explicitly out of scope here.

## Goal

A mobile-first Next.js PWA that renders the shared deterministic engine as a
playable Snake game in a monochrome dot-matrix / Nokia-LCD aesthetic, wires the
real `/session → play → /settle` round-trip (with a temporary placeholder player
address), and shows the **server-authoritative** score and the G$ a verified
human *would* earn — without any wallet or on-chain redemption yet.

## Decisions (locked in brainstorming)

- **Render:** DOM + CSS grid (20×20), not Canvas. Board state drives React; the
  LCD look is pure CSS variables.
- **Theme system:** 8 ship-now themes — `nokia` (**default**), `paper`, `ink`,
  `phosphor`, `amber`, `frost`, `bubblegum`, `tangerine`. Each is a ~6-variable
  token set; adding more is one entry. Player picks one; persisted.
- **Controls are a preference:** swipe always works; an on-screen **D-pad** is
  toggleable (`showDpad`, default **on**). Keyboard (arrows/WASD) on desktop.
- **Sound:** Web Audio synth beeps (no asset files), toggleable (`sound`,
  default **on**), unlocked on first user gesture.
- **A wires the full server round-trip** using a placeholder player address
  (clearly marked TEMP, replaced in B).
- **Speed:** gentle ramp from ~120ms/tick toward an ~80ms floor as the snake
  eats (always ≫ the server's 50ms plausibility gate).
- **Offline:** the app shell + engine are cached so you can **practice offline**;
  earning requires network (`/session`+`/settle`).

## Architecture

New code lives under `apps/web/src`. Pure logic is isolated from React so it can
be unit-tested with the repo's existing `node --test` (no new framework).

### Theme + preferences — `lib/ui/`
- `themes.ts` — `ThemeId` union, `THEMES: Record<ThemeId, ThemeTokens>`,
  `DEFAULT_THEME = "nokia"`, `THEME_ORDER: ThemeId[]`.
  `ThemeTokens = { frame, board, ghost, lit, food, hud, litShadow?, foodShadow? }`
  (all CSS color/shadow strings). `themeVars(tokens): Record<string,string>` maps
  tokens to `--frame`…`--foodShadow` for inline application on a root element.
- `preferences.ts` — `Preferences = { theme: ThemeId; showDpad: boolean; sound: boolean }`;
  `DEFAULT_PREFERENCES`; pure `loadPreferences(raw): Preferences` (tolerant parse
  + clamp to known values) and `serializePreferences`. A thin React context
  (`PreferencesProvider`, `usePreferences`) wraps `localStorage` I/O around the
  pure functions.

### Input — `lib/game/input.ts`
- `swipeToDir(dx, dy, minSwipePx): Dir | null` — dominant-axis resolver; returns
  `null` below the threshold. Maps to engine `Dir` (0=up,1=right,2=down,3=left).
- `keyToDir(key): Dir | null` — arrows + WASD.
- The 180°-reversal guard is **not** re-implemented here; the engine's `setDir`
  already ignores reversals, the single source of truth.

### Game loop — `lib/game/loop.ts`
- `MS_PER_TICK_BASE = 120`, `MS_PER_TICK_FLOOR = 80`, `msPerTick(foodEaten)` — the
  ramp (pure).
- `createRunController({ seed, now })` — wraps engine `State`; methods
  `queueDir(dir)` (calls `setDir`, and when `pendingDir` changes records
  `{ tick, dir }` into the input log), `advance(elapsedMs)` (steps the engine the
  right number of ticks for the elapsed wall-time using the ramp), getters for
  `state`, `inputs`, `alive`. This is the testable core; the React component only
  drives `advance` from `requestAnimationFrame` and reads `state` to render.

### Audio — `lib/audio/sfx.ts`
- `createSfx()` → `{ unlock(), play(name), setEnabled(bool) }` where `name ∈
  {"eat","die","highscore","start","tap"}`. Single `AudioContext`, square-wave
  oscillator + short gain envelope per cue (monophonic Nokia feel). `unlock()`
  resumes the context on first gesture. No-ops gracefully when Web Audio is
  unavailable or sound is disabled. The cue table (freq, duration, shape) is a
  pure data structure, unit-testable for shape; actual playback is browser-only.

### API client — `lib/client/api.ts`
- `createSession(player, fetchImpl?)` → typed `SerializedSession`.
- `submitRun(runId, inputs, fetchImpl?)` → typed `SerializedSettle`.
- `fetchImpl` is injectable so request shaping is unit-testable without a server.
- `PLACEHOLDER_PLAYER` — a constant dev address with a `// TEMP: replaced by Privy
  in sub-project B` marker.

### React surface — `app/` + `components/`
- `app/page.tsx` — the game screen: `PreferencesProvider` + the root theme
  wrapper (applies `themeVars`).
- `components/Board.tsx` — 20×20 CSS grid; cell class from snake set + food.
- `components/Hud.tsx` — wordmark, theme button, live/authoritative score, HI
  (from `localStorage`).
- `components/Dpad.tsx` — shown when `showDpad`; buttons call `queueDir`.
- `components/SettingsSheet.tsx` — the 8-swatch theme grid + D-pad toggle + Sound
  toggle.
- `components/GameOverlay.tsx` — idle (Start) and gameover (authoritative score,
  "earned X G$" or `no_reward` reason, Play Again).
- `useGame()` hook — owns the `idle→playing→gameover` machine, the rAF loop
  driving `RunController.advance`, the `/session` and `/settle` calls, and SFX
  triggers (eat on `foodEaten` increase, die on death, highscore on new best).

### PWA shell
- `app/manifest.ts` (or `public/manifest.webmanifest`), icons, `theme-color`,
  viewport locked (no user-zoom; the board owns the gestures).
- A service worker precaching the app shell + engine bundle for offline practice.
  Offline state surfaces "practice mode — connect to earn"; submit is disabled.

## Data flow (one run)

```
tap Start ─▶ sfx.unlock() ─▶ POST /session {player: PLACEHOLDER}
          ◀─ {seed, runId, issuedAt}
createRunController(seed) ─▶ rAF: advance(dt) → step()/render each tick
   player input ─▶ swipeToDir/keyToDir/Dpad → queueDir → setDir + log{tick,dir}
   eat ─▶ sfx "eat"
death ─▶ sfx "die" ─▶ POST /settle {runId, inputs}
      ◀─ accepted{score, amount} | no_reward{reason} | rejected{reason}
show authoritative score + earned G$ ; if score>HI → sfx "highscore", save HI
```

The client renders its local score live, but the **displayed result and earned
amount come only from `/settle`** — never a client claim. Consistent with the
score-integrity model already built.

## Testing

`node --test` with `--experimental-strip-types`, TDD where it pays. Unit targets
(all pure, no DOM):

- `swipeToDir` / `keyToDir` — axis/threshold/None and key mappings.
- `msPerTick` ramp — base, floor, monotonic.
- `RunController` — `queueDir` logs exactly on `pendingDir` change; `advance`
  steps the right tick count for elapsed ms; input log matches a `simulate`
  replay of the same seed (closes the client↔server determinism loop in a test).
- `loadPreferences` — defaults, bad/partial input clamped, unknown theme → default.
- `themes` — every theme defines every required token; `DEFAULT_THEME` exists.
- `api` client — `createSession`/`submitRun` shape the request (method, path,
  JSON body) against an injected `fetch`.
- SFX cue table — every cue name present with sane freq/duration.

React components stay thin and are verified by `next build` + manual play; no
jsdom/component-test framework is added in A.

## Out of scope (→ B / C)

- Any Privy / wallet code; the real player address (A uses `PLACEHOLDER_PLAYER`).
- GoodDollar face verification; on-chain voucher redemption.
- Offline **queuing** of chain calls for reconnect (A only caches the shell for
  practice).
- A pixel/bitmap font (system `ui-monospace` for v1) and CRT/scanline FX.
