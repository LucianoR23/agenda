import type { IconName } from "./icons";

/**
 * Block type registry (Sistema Calma). A new type is one row here plus the API enum value.
 * Color comes from the hue with fixed L/C per theme (see tokens.css): dark oklch(0.78 0.06 h), light oklch(0.50 0.08 h).
 * `call` uses its own token and always shows actions; `hue: null` = neutral.
 */
export const BLOCK_TYPES = {
  call: { label: "Llamada", icon: "call", hue: "call" },
  meeting: { label: "Reunión", icon: "groups", hue: 250 },
  routine: { label: "Rutina", icon: "self_improvement", hue: 195 },
  gym: { label: "Gym", icon: "fitness_center", hue: 145 },
  meal: { label: "Comida", icon: "restaurant", hue: 85 },
  reading: { label: "Lectura", icon: "menu_book", hue: 290 },
  study: { label: "Estudio", icon: "school", hue: 265 },
  dogs: { label: "Perras", icon: "pets", hue: 55 },
  partner: { label: "Pareja", icon: "favorite", hue: 350 },
  sleep: { label: "Sueño", icon: "bedtime", hue: 225 },
  local_work: { label: "Trabajo en el local", icon: "storefront", hue: 210 },
  padel: { label: "Pádel", icon: "sports_tennis", hue: 115 },
  other: { label: "Otro", icon: "more_horiz", hue: null },
} as const satisfies Record<string, { label: string; icon: IconName; hue: number | "call" | null }>;

export type BlockTypeKey = keyof typeof BLOCK_TYPES;

/** CSS color for a block type, e.g. `var(--t-gym)`. */
export const typeColor = (type: BlockTypeKey) => `var(--t-${type})`;
