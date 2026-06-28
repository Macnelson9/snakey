"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dir, State } from "@buga/engine";
import { createRunController, type RunController } from "@/lib/game/loop.ts";
import { keyToDir } from "@/lib/game/input.ts";
import { createSession, submitRun, PLACEHOLDER_PLAYER, type SettleResponse } from "@/lib/client/api.ts";
import { createSfx } from "@/lib/audio/sfx.ts";
import { usePreferences } from "./PreferencesProvider.tsx";

const HI_KEY = "buga.hi";
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
  const starting = useRef(false);

  const endRun = useCallback(async () => {
    if (raf.current) { cancelAnimationFrame(raf.current); raf.current = null; }
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
    const stepped = c.advance(dt);
    if (c.state.foodEaten > before) sfx.play("eat");
    if (stepped > 0) force((n) => n + 1);
    if (!c.alive) { void endRun(); return; }
    raf.current = requestAnimationFrame(tick);
  }, [endRun, sfx]);

  const start = useCallback(async () => {
    if (starting.current) return;
    starting.current = true;
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
    starting.current = false;
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
