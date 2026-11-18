"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "@/client/api";
import type { AuditEntry, AuditKind, AuditPage } from "@/client/types";
import { Button, FilterChip } from "../components/controls";
import { Icon } from "../components/icon";
import { PageTitle, SectionLabel } from "../components/page";
import { EmptyState, TimelineSkeleton } from "../components/surfaces";
import { cx } from "../cx";
import type { IconName } from "../icons";
import { dayLabel, userTimeZone } from "../time";

/** Ajustes → Auditoría: every change, newest first. Read-only: nothing here can be undone or deleted. */

const KINDS: Array<[AuditKind | null, string]> = [
  [null, "Todo"],
  ["task", "Tareas"],
  ["reminder", "Recordatorios"],
  ["event", "Eventos"],
  ["habit", "Hábitos"],
  ["sleep", "Sueño"],
  ["review", "Cierre"],
];

const ACTION: Record<AuditEntry["action"], { verb: string; icon: IconName; tone?: string }> = {
  created: { verb: "Creaste", icon: "add" },
  edited: { verb: "Editaste", icon: "edit" },
  completed: { verb: "Completaste", icon: "check_circle", tone: "text-success" },
  cancelled: { verb: "Cancelaste", icon: "do_not_disturb_on" },
  reopened: { verb: "Reabriste", icon: "undo" },
  rescheduled: { verb: "Moviste", icon: "update" },
  archived: { verb: "Archivaste", icon: "inbox" },
  restored: { verb: "Reactivaste", icon: "inbox" },
  checked: { verb: "Marcaste", icon: "radio_button_checked", tone: "text-success" },
  unchecked: { verb: "Desmarcaste", icon: "radio_button_unchecked" },
  deleted: { verb: "Borraste", icon: "delete", tone: "text-danger" },
};

const WHAT: Record<AuditEntry["entity"], string> = {
  task: "tarea",
  task_list: "lista",
  reminder: "recordatorio",
  event: "evento",
  habit: "hábito",
  habit_log: "hábito",
  sleep_log: "sueño",
  day_review: "cierre",
};

/** Field names as Lemy would say them. */
const FIELD: Record<string, string> = {
  title: "título",
  notes: "nota",
  dueDate: "fecha",
  dueTime: "hora",
  fireAt: "hora",
  startsAt: "inicio",
  endsAt: "fin",
  location: "lugar",
  rrule: "repetición",
  priority: "prioridad",
  listId: "lista",
  tags: "etiquetas",
  reminderOffsets: "avisos",
  urgent: "urgente",
  name: "nombre",
  body: "texto",
  value: "valor",
  targetCount: "meta",
  status: "estado",
};

const zoned = (iso: string) => Temporal.Instant.from(iso).toZonedDateTimeISO(userTimeZone());

function who(e: AuditEntry) {
  if (e.actor === "sunday") return e.tokenName && e.tokenName !== "sunday" ? `Sunday (${e.tokenName})` : "Sunday";
  if (e.actor === "system") return "Automático";
  return null;
}

export function AuditScreen() {
  const [kind, setKind] = useState<AuditKind | null>(null);
  const q = useInfiniteQuery({
    queryKey: ["audit", kind],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ ...(kind ? { kind } : {}), ...(pageParam ? { before: pageParam } : {}) });
      return get<AuditPage>(`/api/audit?${params}`);
    },
    getNextPageParam: (last) => last.next,
  });
  const entries = q.data?.pages.flatMap((p) => p.entries) ?? [];
  const days = new Map<string, AuditEntry[]>();
  for (const e of entries) {
    const day = zoned(e.at).toPlainDate().toString();
    days.set(day, [...(days.get(day) ?? []), e]);
  }

  return (
    <div className="flex flex-col gap-4">
      <PageTitle title="Auditoría" back="/ajustes" subtitle="Todo lo que se creó, cambió, completó o borró, y quién lo hizo." />
      <div className="flex flex-wrap gap-2">
        {KINDS.map(([k, label]) => (
          <FilterChip key={label} selected={kind === k} onClick={() => setKind(k)}>
            {label}
          </FilterChip>
        ))}
      </div>
      {q.isPending ? (
        <TimelineSkeleton heights={[56, 56, 56, 56]} />
      ) : q.isError ? (
        <p className="px-1 text-body-sm text-text2">{q.error.message}</p>
      ) : entries.length === 0 ? (
        <EmptyState icon="notes" title="Sin cambios" body="Todavía no hay nada registrado acá." />
      ) : (
        <>
          {[...days].map(([day, list]) => (
            <section key={day} className="flex flex-col gap-2">
              <SectionLabel>{dayLabel(day)}</SectionLabel>
              <ul className="flex flex-col overflow-hidden rounded-lg bg-surface [&>*+*]:border-t [&>*+*]:border-border">
                {list.map((e) => (
                  <Row key={e.id} entry={e} />
                ))}
              </ul>
            </section>
          ))}
          {q.hasNextPage && (
            <Button variant="secondary" disabled={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
              {q.isFetchingNextPage ? "Cargando…" : "Ver más"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function Row({ entry: e }: { entry: AuditEntry }) {
  const a = ACTION[e.action];
  const by = who(e);
  const fields = e.action === "edited" ? e.fields.map((f) => FIELD[f] ?? f) : [];
  return (
    <li className="flex items-start gap-3 px-3.5 py-2.5">
      <Icon name={a.icon} size={20} className={cx("mt-0.5 shrink-0", a.tone ?? "text-muted")} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] text-text">
          {a.verb} {WHAT[e.entity]} <span className="font-semibold">{e.label ? `«${e.label}»` : "(sin nombre)"}</span>
        </span>
        <span className="text-caption text-muted">
          {zoned(e.at).toPlainTime().toString({ smallestUnit: "minute" })}
          {by && ` · ${by}`}
          {fields.length > 0 && ` · ${[...new Set(fields)].join(", ")}`}
        </span>
      </span>
    </li>
  );
}
