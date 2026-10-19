// `pnpm pwa:icons` — renders the app icons (PNG) from the Sistema Calma glyph with headless Chromium.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const sprite = readFileSync("public/icons.svg", "utf8");
const glyph = /<symbol id="today" viewBox="([^"]+)">([\s\S]*?)<\/symbol>/.exec(sprite);
const svg = (size, { maskable = false, mono = false } = {}) => {
  const pad = maskable ? size * 0.22 : size * 0.18;
  const radius = maskable ? 0 : size * 0.22;
  const bg = mono ? "transparent" : "#111312";
  const fg = mono ? "#ffffff" : "oklch(0.82 0.08 160)";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${bg}"/>
    <svg x="${pad}" y="${pad}" width="${size - 2 * pad}" height="${size - 2 * pad}" viewBox="${glyph[1]}" fill="${fg}">${glyph[2]}</svg>
  </svg>`;
};
const targets = [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, { maskable: true }],
  ["badge-96.png", 96, { mono: true }],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, opts] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opts)}</body></html>`);
  await page.locator("svg").first().screenshot({ path: `public/icons/${name}`, omitBackground: true });
}
await browser.close();
console.log(`✓ ${targets.length} icons in public/icons`);
