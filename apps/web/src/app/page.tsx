"use client";
import { useRef, useState } from "react";
import { createState, type State } from "@buga/engine";
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
