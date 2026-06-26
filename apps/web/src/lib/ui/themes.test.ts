import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMES, THEME_ORDER, DEFAULT_THEME, themeVars, type ThemeId } from "./themes.ts";

const REQUIRED = ["frame", "board", "ghost", "lit", "food", "hud"] as const;

test("every theme in THEME_ORDER defines every required token", () => {
  assert.equal(THEME_ORDER.length, 8);
  for (const id of THEME_ORDER) {
    const t = THEMES[id];
    assert.ok(t, `missing theme ${id}`);
    for (const k of REQUIRED) assert.equal(typeof (t as unknown as Record<string, unknown>)[k], "string", `${id}.${k}`);
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
  assert.ok(g["--lit-shadow"]!.includes("0 0")); // phosphor glows
});
