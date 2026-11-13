import type { IconName } from "../icons";

/** Material Symbols Rounded from the `/icons.svg` sprite. Decorative unless `label` is given. */
export function Icon({
  name,
  size = 20,
  className,
  label,
  color,
}: {
  name: IconName;
  size?: number;
  className?: string | undefined;
  label?: string | undefined;
  /** CSS color, e.g. `var(--accent)`; defaults to currentColor. */
  color?: string | undefined;
}) {
  return (
    <svg
      width={size}
      height={size}
      className={`shrink-0 fill-current ${className ?? ""}`}
      style={color ? { color } : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <use href={`/icons.svg#${name}`} />
    </svg>
  );
}
