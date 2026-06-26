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
