/** The Agenda mark (Claude Design "Agenda - Icono"): the now line crossing the timeline. Follows the theme tokens. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="130 126 252 260" width={size} height={size} aria-hidden>
      <rect x="176" y="146" width="136" height="44" rx="14" fill="var(--mark-done)" />
      <rect x="176" y="258" width="186" height="44" rx="14" fill="var(--call)" />
      <rect x="176" y="322" width="110" height="44" rx="14" fill="var(--text)" />
      <line x1="150" y1="224" x2="362" y2="224" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" />
      <circle cx="150" cy="224" r="17" fill="var(--accent)" />
    </svg>
  );
}
