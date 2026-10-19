import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./icon";

/** Screen title (display 32) with an optional back link and trailing action. */
export function PageTitle({ title, back, trailing, subtitle }: { title: string; back?: string; trailing?: ReactNode; subtitle?: string }) {
  return (
    <header className="flex flex-col gap-1 pt-2">
      {back && (
        <Link href={back} className="-ml-1 flex min-h-11 items-center gap-1 self-start text-body-sm text-accent">
          <Icon name="chevron_left" size={18} /> Volver
        </Link>
      )}
      <div className="flex items-end justify-between gap-3">
        <h1 className="text-display text-text">{title}</h1>
        {trailing}
      </div>
      {subtitle && <p className="text-body-sm text-text2">{subtitle}</p>}
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="px-1 pt-2 font-mono text-mono tracking-[.08em] text-muted uppercase">{children}</h2>;
}
