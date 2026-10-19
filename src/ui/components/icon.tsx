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
  className?: string;
  label?: string;
  /** CSS color, e.g. `var(--t-gym)`; defaults to currentColor. */
  color?: string;
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
