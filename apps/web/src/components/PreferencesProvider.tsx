"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DEFAULT_PREFERENCES, loadPreferences, serializePreferences, type Preferences } from "@/lib/ui/preferences.ts";

const KEY = "buga.prefs";
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
