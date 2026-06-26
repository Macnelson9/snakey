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
