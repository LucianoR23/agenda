# Design: Sistema Calma v0.2

Source: Claude Design project "Agenda" → `Agenda - Sistema.dc.html` (copy in `design/`, read-only reference).
Living implementation: **`/dev/design`** (dev server only), the same gallery rendered with the real contract examples
in both themes.

## Where each part lives

| Design | Code |
|---|---|
| Semantic color tokens (dark primary + light) | `src/app/globals.css` (`:root` / `[data-theme]`) → Tailwind colors `bg-surface`, `text-muted`, `border-border2`… |
| Block type registry (13 types, hue → color) | `src/ui/block-types.ts` + `--t-<type>` vars; dark `oklch(0.78 0.06 h)`, light `oklch(0.50 0.08 h)`, call = `--call`, other = neutral |
| Type scale (display 32 … micro 11) | Tailwind `text-display`, `text-title`, `text-headline`, `text-body`, `text-body-sm`, `text-caption`, `text-mono`, `text-micro` |
| Instrument Sans / Geist Mono | `next/font/google` in `src/app/layout.tsx` (self-hosted at build) |
| Material Symbols Rounded | SVG sprite `public/icons.svg` built by `pnpm icons` from `src/ui/icons.ts` (no 3 MB icon font; works offline) |
| Radius 8/12/16/20/28/pill, spacing base 4 | Tailwind `rounded-sm…2xl`, default spacing scale |
| Motion 80/120/200/280 ms, `cubic-bezier(.2,.8,.2,1)` | `duration-instant`, default 120 ms, `duration-base`, `duration-sheet`, `ease-calma`; reduced-motion respected |
| Elevation (dark by tone, light white + shadow) | `bg-surface` / `bg-surface2` / `bg-raised`, `shadow-calma` |
| Components | `src/ui/components/*`: `BlockCard`, `NowLine`, `OptionCard`, `Button`, chips, `Segmented`, `Toggle`, `Ring`, `StreakChip`, `Fab`, `Sheet` + rows, `Banner`, `Toast`, `SyncStatus`, `StatCard`, `ChartCard`, `BarChart`, `Sparkline`, `HeatCell`, `EmptyState`, `TimelineSkeleton`, `PinPad`, `TabBar`, `DayHeader`, `SectionCard`, `SettingsRow` |

## Extensions (not in the design, built from its tokens and patterns)

- **Sleep card** on "Hoy": "Me voy a dormir" / "Me levanté", morning reminder state, summary (slept, delay vs plan).
- **Proposal diff** behind the "Agenbot propone…" banner: moved / added / removed / changed / kept (gone from
  Calendar but tracked) / "queda como lo dejaste" (my overrides), Aceptar / Rechazar.
- **"Me atrasé"** sheet: segmented +15 / +30 / +60, affected count, past-midnight note `(+1)`.
- **Conflict sheet**: "Tu cambio" vs "En el servidor".
- **Cierre del día** card: pending blocks, energy and mood 1–5 (segmented), note.
- **Outcome picker** rows for calls.
- **Block states** the design lacks: "Ya no está en Google Calendar" (dashed, `event_busy`), past midnight (`00:15 +1`).

## Adjustments to the design

- **PIN has 6 dots** (spec: 6-digit PIN); the design shows 4.
- **Tab label "Tareas"** as in the design; the screen title is "Tareas y hábitos".
- **"Avisarme 10 min antes" per block** (design) → new block field `remind` (default on for calls). The device toggle
  in Ajustes stays as the master switch.
- **"Armar mi día"** (empty state) → new `POST /api/days/{date}`: my own day, already chosen; Agenbot's later load
  arrives as a proposal.
- **Métricas "Año"** (segmented Semana · Mes · Año) → `range=year`.
- **Icons renamed upstream**: `auto_awesome` → `star_shine` glyph, `insights` → `monitoring` glyph (names kept in code).
- **Theme** follows the system with dark as the base; Ajustes → Apariencia can force dark or light per device.
- Example data uses the design's wording: "Paseo con las perras", call titles as the kind of call ("Llamada de
  cierre") with the lead name as the big line.
- **Not built** (marked future in the design): block metadata row (attachments, tags, timer) and the "Leads" module;
  the "Más" tab pattern is ready for when there are 6+ sections.

## Design's open questions, answered from the spec

1. *¿Los bloques hechos bajan de opacidad o solo cambian el ícono?* → Both, as in the design samples (opacity .55 + ✓).
2. *¿Deslizar ← en un bloque de Calendar también lo marca salteado?* → Yes: tracking fields are mine even on calendar
   blocks; only the schedule belongs to Google.
3. *¿Huella por defecto o PIN primero?* → Fingerprint first on devices where it is enabled, PIN as fallback (spec §4.4).
