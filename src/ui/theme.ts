"use client";

export type ThemePref = "system" | "dark" | "light";

const KEY = "agenda:theme";

export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "dark" || v === "light" ? v : "system";
  } catch {
    return "system";
  }
}

/** Per-device override (D64): sets/clears `data-theme` on <html>. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {}
}

/** Inline script for <head>: applies the saved theme before first paint (no flash). */
export const THEME_BOOT = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
