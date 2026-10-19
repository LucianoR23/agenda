// `pnpm pwa:icons` — writes the app icons (Claude Design "Agenda - Icono" v0.3): SVG masters + PNGs rendered with
// headless Chromium + favicon.ico. The symbol is the "now" line crossing the timeline: a done block above, the next
// call in amber and what follows.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BG = "#111312";
// Design geometry shifted 8 px right so the composition (dot included) is centred on 256 both ways; its farthest
// corner stays 158 px from the centre, inside Android's adaptive-icon crop (~169 px), not only the 40% maskable zone.
const symbol = ({ done = "#5B5F5A", call = "#EDB866", next = "#ECEDEA", now = "#8ECDB0" } = {}) =>
  `<g transform="translate(8 0)">` +
  `<rect x="176" y="146" width="136" height="44" rx="14" fill="${done}"/>` +
  `<rect x="176" y="258" width="186" height="44" rx="14" fill="${call}"/>` +
  `<rect x="176" y="322" width="110" height="44" rx="14" fill="${next}"/>` +
  `<line x1="150" y1="224" x2="362" y2="224" stroke="${now}" stroke-width="8" stroke-linecap="round"/>` +
  `<circle cx="150" cy="224" r="17" fill="${now}"/></g>`;
// ≤ 32 px: no white block, thicker line (the design's simplified favicon)
const small = ({ done = "#5B5F5A", call = "#EDB866", now = "#8ECDB0" } = {}) =>
  `<rect x="150" y="150" width="150" height="56" rx="18" fill="${done}"/>` +
  `<rect x="150" y="306" width="212" height="56" rx="18" fill="${call}"/>` +
  `<line x1="120" y1="256" x2="392" y2="256" stroke="${now}" stroke-width="22" stroke-linecap="round"/>`;
const svg = (body, bg = "", rx = 0) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg ? `<rect width="512" height="512"${rx ? ` rx="${rx}"` : ""} fill="${bg}"/>` : ""}${body}</svg>`;

const white = "#fff";
const masters = {
  // rounded tile, never masked: browsers, desktop, in-app. 15% bigger so it reads at 48 px.
  any: svg(`<g transform="translate(256 256) scale(1.15) translate(-256 -256)">${symbol()}</g>`, BG, 114),
  maskable: svg(symbol(), BG), // full bleed: Android masks it
  mono: svg(symbol({ done: "rgba(255,255,255,.45)", call: white, next: white, now: white })), // themed icon (alpha only)
  favicon: svg(small(), BG, 120),
  badge: svg(small({ done: "rgba(255,255,255,.45)", call: white, now: white })), // notification status-bar badge
};
writeFileSync("public/icons/icon-any.svg", masters.any + "\n");
writeFileSync("public/icons/favicon.svg", masters.favicon + "\n");

const pngs = [
  ["icon-192.png", 192, "any"],
  ["icon-512.png", 512, "any"],
  ["maskable-192.png", 192, "maskable"],
  ["maskable-512.png", 512, "maskable"],
  ["monochrome-512.png", 512, "mono"],
  ["apple-touch-icon.png", 180, "maskable"], // iOS rounds the corners itself
  ["favicon-32.png", 32, "favicon"],
  ["favicon-16.png", 16, "favicon"],
  ["badge-96.png", 96, "badge"],
];
const browser = await chromium.launch();
const page = await browser.newPage();
const out = {};
for (const [name, size, master] of pngs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${masters[master].replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  out[name] = await page.locator("svg").screenshot({ omitBackground: true });
  if (name !== "favicon-16.png") writeFileSync(`public/icons/${name}`, out[name]);
}
await browser.close();

// favicon.ico for clients that only ask for /favicon.ico: PNG-compressed entries (16 + 32)
const entries = [16, 32].map((s) => [s, out[`favicon-${s}.png`]]);
const header = Buffer.alloc(6 + 16 * entries.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(([s, png], i) => {
  const e = 6 + 16 * i;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(png.length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += png.length;
});
writeFileSync("public/favicon.ico", Buffer.concat([header, ...entries.map(([, png]) => png)]));
console.log(`✓ ${pngs.length - 1} PNGs, 2 SVGs and favicon.ico in public/`);
