"use client";

import { useQueryClient } from "@tanstack/react-query";
import { motion, type PanInfo } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { uuidv7 } from "uuidv7";
import { api, ApiProblem } from "@/client/api";
import { useAdjustments, useDay, useHabits, useWrites } from "@/client/queries";
import { useSync } from "@/client/sync";
import type { Block, Day } from "@/client/types";
import { typeColor } from "../../block-types";
import { Button, Fab, PageDots, Ring, StreakChip } from "../../components/controls";
import { DayReviewCard, ProposalDiffView, ShiftChooser, SleepCard } from "../../components/extensions";
import { Banner, SyncStatus } from "../../components/feedback";
import { Icon } from "../../components/icon";
import { DayHeader } from "../../components/navigation";
import { BottomSheet, useToast } from "../../components/overlay";
import { EmptyState, OptionCard, SectionCard, TimelineSkeleton } from "../../components/surfaces";
import { cx } from "../../cx";
import { localHHmm } from "../../format";
import { addDays, ago, dayLabel, haptic, nowHHmm, todayART, useNow } from "../../time";
import { AddChooser, AdjustmentForm, AdjustmentsCard } from "./adjustments";
import { BlockEditor } from "./block-editor";
import { SleepEditor } from "./sleep-editor";
import { Timeline } from "./timeline";

type Sheet =
  | { kind: "block"; block: Block | null; focusOutcome?: boolean }
  | { kind: "proposal" }
  | { kind: "shift" }
  | { kind: "sleep"; night: string }
  | { kind: "add" }
  | { kind: "adjust" }
  | null;

const chosenOption = (d: Day) => d.options.find((o) => o.id === d.chosenOptionId) ?? null;

export function TodayScreen() {
  const now = useNow();
  const today = todayART(now);
  // deep links from pushes: /?date=…&proposal=1
  const [date, setDate] = useState(() => {
    const d = new URLSearchParams(window.location.search).get("date");
    return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  });
  const [autoProposal, setAutoProposal] = useState(() => new URLSearchParams(window.location.search).has("proposal"));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [optionIndex, setOptionIndex] = useState(0);
  const [shiftBy, setShiftBy] = useState<15 | 30 | 60>(30);
  const qc = useQueryClient();
  const toast = useToast();
  const sync = useSync();
  const writes = useWrites(date);
  const q = useDay(date);
  const day = q.data;
  const adjustments = useAdjustments(date).data?.adjustments ?? [];

  useEffect(() => {
    const url = date === today ? "/" : `/?date=${date}`;
    window.history.replaceState(null, "", url);
  }, [date, today]);

  // auto-scroll to "now" once per day; a push about a request (?adjustments=1) lands on its card instead
  const scrolled = useRef<string | null>(null);
  const [toRequests] = useState(() => new URLSearchParams(window.location.search).has("adjustments"));
  useEffect(() => {
    if (!day || scrolled.current === day.date) return;
    if (toRequests) {
      const card = document.querySelector('[data-testid="adjustments"]');
      if (card) {
        card.scrollIntoView({ block: "center" });
        scrolled.current = day.date;
      }
      return;
    }
    if (day.date !== today || day.status === "draft") return;
    const el = document.querySelector('[aria-label^="Ahora"]');
    if (el) {
      el.scrollIntoView({ block: "center" });
      scrolled.current = day.date;
    }
  }, [day, today, toRequests, adjustments.length]);

  const isToday = date === today;
  const nowTime = nowHHmm(now);
  const option = day ? (chosenOption(day) ?? day.options[optionIndex] ?? day.options[0]) : null;
  const blocks = option?.blocks ?? [];

  const swipe = async (b: Block, status: "done" | "skipped") => {
    const prev = b.status;
    await writes.patchBlock(b.id, { status }, status === "done" ? `${b.title} hecho` : `${b.title} salteado`);
    haptic(20);
    toast({
      icon: status === "done" ? "check_circle" : "do_not_disturb_on",
      message: `${b.title} marcado como ${status === "done" ? "hecho" : "salteado"}`,
      action: "Deshacer",
      onAction: () => void writes.patchBlock(b.id, { status: prev }),
    });
    if (status === "done" && b.type === "call" && !b.outcome) setSheet({ kind: "block", block: { ...b, status: "done" }, focusOutcome: true });
  };

  const move = (b: Block, to: { start: string; end: string | null } | null, ordered: string[]) => {
    if (to) void writes.patchBlock(b.id, to, `${b.title} movido`);
    else {
      const movable = new Set(blocks.filter((x) => x.source !== "calendar").map((x) => x.id));
      void writes.send("POST", `/api/days/${date}/blocks/reorder`, { ids: ordered.filter((id) => movable.has(id)) }, "Orden");
    }
  };

  const direct = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["day", date] });
      await qc.invalidateQueries({ queryKey: ["adjustments", date] });
      if (ok) toast({ message: ok });
      return true;
    } catch (e) {
      toast({ icon: "sync_problem", message: e instanceof ApiProblem && e.offline ? "Necesitás conexión para esto." : e instanceof ApiProblem ? (e.problem.detail ?? e.problem.title) : "Error" });
      return false;
    }
  };

  const shiftable = blocks.filter((b) => b.source !== "calendar" && b.status === "pending" && !b.locked && b.start >= nowTime).length;

  // swipe on the header to change day
  const headerDrag = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60) setDate(addDays(date, 1));
    else if (info.offset.x > 60) setDate(addDays(date, -1));
  };

  const hour = Number(nowTime.slice(0, 2));
  const sleepMode = !isToday || !day ? null : hour >= 20 || hour < 5 ? "night" : hour < 14 ? "morning" : null;
  const nightDate = hour < 5 ? addDays(today, -1) : today;
  // "Pedir ajuste" is for today or later, on days that are not closed (D92)
  const closed = date < today || day?.status === "closed";
  const reviewDue = isToday && day && day.status !== "closed" && day.status !== "draft" && !day.review && nowTime >= "22:00";

  return (
    <div className="flex flex-col gap-4">
      <motion.div drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.3} onDragEnd={headerDrag}>
        <DayHeader label={dayLabel(date, today)} onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} />
      </motion.div>

      <div className="flex items-center justify-between gap-2">
        <SyncStatus state={!sync.online ? "offline" : sync.syncing || q.isFetching ? "syncing" : "idle"} lastSync={sync.lastSync ? ago(sync.lastSync, now.getTime()) : null} />
        {isToday && day && (day.status === "chosen" || day.status === "edited") && (
          <button type="button" onClick={() => setSheet({ kind: "shift" })} className="flex h-9 items-center gap-1.5 rounded-full border border-border2 px-3 text-body-sm text-text">
            <Icon name="more_time" size={16} /> Me atrasé
          </button>
        )}
      </div>

      {day?.pendingProposal && (
        <Banner
          kind="proposal"
          title={`Agenbot propone ${(() => {
            const d = day.pendingProposal.diff;
            const n = d.moved.length + d.added.length + d.removed.length + d.changed.length;
            return `${n} ${n === 1 ? "cambio" : "cambios"}`;
          })()}`}
          action="Ver"
          onAction={() => setSheet({ kind: "proposal" })}
        >
          {day.pendingProposal.reason ?? "Revisalo antes de aplicarlo."}
        </Banner>
      )}

      <AdjustmentsCard
        items={adjustments}
        onOpenProposal={() => setSheet({ kind: "proposal" })}
        onCancel={(a) => {
          void writes.cancelAdjustment(a);
          toast({ icon: "close", message: "Pedido cancelado" });
        }}
      />

      {sleepMode && day && (
        <SleepCard
          mode={sleepMode}
          previousNight={day.sleep.previousNight}
          night={hour < 5 ? day.sleep.previousNight : day.sleep.night}
          onBed={() => void writes.send("POST", "/api/sleep/events", { type: "bed" }, "Me voy a dormir", [JSON.stringify(["day", addDays(date, 1)])])}
          onWake={() => void writes.send("POST", "/api/sleep/events", { type: "wake" }, "Me levanté", [JSON.stringify(["day", addDays(date, -1)])])}
          onEdit={() => setSheet({ kind: "sleep", night: sleepMode === "morning" ? addDays(today, -1) : nightDate })}
        />
      )}

      {q.isLoading && !day && <TimelineSkeleton />}

      {q.error?.problem.code === "day_not_found" && (
        <EmptyState
          icon="schedule"
          title={isToday ? "Agenbot todavía no cargó tu día" : "No hay plan para este día"}
          body={isToday ? "Suele llegar a las 07:00. Podés esperarlo o armarlo vos." : "Podés armarlo vos; si Agenbot lo carga después, te llega como propuesta."}
          actions={
            <>
              <Button onClick={() => void direct(() => api("POST", `/api/days/${date}`, {}), "Día creado")}>Armar mi día</Button>
              <Button variant="secondary" onClick={() => void q.refetch()}>
                Reintentar
              </Button>
            </>
          }
        />
      )}

      {day && day.status === "draft" && (
        <DraftPicker
          day={day}
          index={optionIndex}
          onIndex={setOptionIndex}
          onChoose={() => void direct(() => api("POST", `/api/days/${date}/choose`, { option: day.options[optionIndex].label }), `Elegiste la opción ${day.options[optionIndex].label}`)}
        />
      )}

      {day && day.status !== "draft" && <Banner kind="info">{day.status === "closed" ? "Día cerrado. Podés corregir lo que haga falta." : `Opción ${day.chosenOption} · ${chosenOption(day)?.title ?? ""}`}</Banner>}

      {day && (
        <Timeline
          blocks={blocks}
          nowTime={isToday ? nowTime : null}
          onOpen={(b) => setSheet({ kind: "block", block: b })}
          onSwipe={(b, s) => void swipe(b, s)}
          onMove={move}
        />
      )}

      {reviewDue && <ReviewCard day={day!} pending={blocks.filter((b) => b.status === "pending").length} />}

      {day && isToday && day.status !== "draft" && <HabitsToday />}

      {(day || !closed) && (
        // above the sticky "Elegir esta" while choosing an option
        <div className={cx("fixed right-4 z-20", day?.status === "draft" ? "bottom-[calc(156px+env(safe-area-inset-bottom))] md:bottom-24" : "bottom-[calc(96px+env(safe-area-inset-bottom))] md:bottom-8")}>
          <Fab label="Agregar" onClick={() => setSheet({ kind: "add" })} />
        </div>
      )}

      {/* room to scroll the last block clear of the add button */}
      <div className="h-16" aria-hidden />

      <BottomSheet open={sheet?.kind === "add"} onClose={() => setSheet(null)} label="Agregar">
        <AddChooser
          canBlock={!!day}
          canAsk={!closed}
          onBlock={() => setSheet({ kind: "block", block: null })}
          onAsk={() => setSheet({ kind: "adjust" })}
        />
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "adjust"} onClose={() => setSheet(null)} label="Pedido a Agenbot">
        {sheet?.kind === "adjust" && (
          <AdjustmentForm
            defaultDate={date}
            today={today}
            onSend={(forDate, text) => {
              void writes.requestAdjustment(forDate, text);
              toast({ icon: "auto_awesome", message: forDate === date ? "Pedido enviado. Agenbot te responde con una propuesta." : `Pedido enviado para el ${forDate.slice(8)}/${forDate.slice(5, 7)}.` });
              setSheet(null);
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "block"} onClose={() => setSheet(null)} label="Bloque">
        {sheet?.kind === "block" && (
          <BlockEditor
            key={sheet.block?.id ?? "new"}
            block={sheet.block}
            defaultStart={isToday ? nowTime.slice(0, 3) + (Number(nowTime.slice(3)) < 30 ? "30" : "45") : "09:00"}
            focusOutcome={sheet.focusOutcome}
            onSave={(patch) => {
              if (sheet.block && Object.keys(patch).length) void writes.patchBlock(sheet.block.id, patch, "Bloque guardado");
              setSheet(null);
            }}
            onCreate={(d) => {
              const body = { id: uuidv7(), start: d.start, ...(d.end ? { end: d.end } : {}), title: d.title.trim(), type: d.type, ...(d.type === "call" && d.callKind ? { callKind: d.callKind } : {}), ...(d.detail ? { detail: d.detail } : {}), locked: d.locked, remind: d.remind };
              void writes.send("POST", `/api/days/${date}/blocks${day?.status === "draft" ? `?option=${option?.label}` : ""}`, body, "Bloque nuevo");
              setSheet(null);
            }}
            onDelete={() => {
              if (sheet.block) void writes.send("DELETE", `/api/days/${date}/blocks/${sheet.block.id}`, undefined, "Bloque borrado");
              setSheet(null);
            }}
          />
        )}
      </BottomSheet>

      <BottomSheet open={(sheet?.kind === "proposal" || autoProposal) && !!day?.pendingProposal} onClose={() => (setSheet(null), setAutoProposal(false))} label="Propuesta de Agenbot">
        {day?.pendingProposal && (
          <ProposalDiffView
            reason={day.pendingProposal.reason}
            diff={day.pendingProposal.diff}
            onAccept={() => void direct(() => api("POST", `/api/days/${date}/proposals/${day.pendingProposal!.id}/accept`), "Cambios aplicados").then((ok) => ok && setSheet(null))}
            onReject={() => void direct(() => api("POST", `/api/days/${date}/proposals/${day.pendingProposal!.id}/reject`), "Propuesta rechazada").then((ok) => ok && setSheet(null))}
          />
        )}
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "shift"} onClose={() => setSheet(null)} label="Me atrasé">
        <ShiftChooser
          value={shiftBy}
          onChange={setShiftBy}
          fromTime={nowTime}
          affected={shiftable}
          onApply={() => {
            void writes.send("POST", `/api/days/${date}/shift`, { fromTime: nowTime, minutes: shiftBy }, "Me atrasé");
            toast({ icon: "more_time", message: `Corrí ${shiftable} bloques ${shiftBy} min` });
            setSheet(null);
          }}
        />
      </BottomSheet>

      <BottomSheet open={sheet?.kind === "sleep"} onClose={() => setSheet(null)} label="Sueño">
        {sheet?.kind === "sleep" && day && (
          <SleepEditor
            night={sheet.night}
            log={sheet.night === day.date ? day.sleep.night : day.sleep.previousNight}
            onSave={(body) => {
              void writes.send("PUT", `/api/sleep/${sheet.night}`, body, "Sueño", [JSON.stringify(["day", addDays(sheet.night, 1)])]);
              setSheet(null);
            }}
          />
        )}
      </BottomSheet>
    </div>
  );
}

function DraftPicker({ day, index, onIndex, onChoose }: { day: Day; index: number; onIndex: (i: number) => void; onChoose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const summary = (o: Day["options"][number]) => {
    const calls = o.blocks.filter((b) => b.type === "call").length;
    const gym = o.blocks.some((b) => b.type === "gym");
    return `${o.blocks.length} bloques · ${calls} ${calls === 1 ? "llamada" : "llamadas"}${gym ? " · gym ✓" : ""}`;
  };
  return (
    <>
      <Banner kind="info">Agenbot cargó tu día a las {localHHmm(day.createdAt)}. Deslizá para ver las opciones.</Banner>
      <div
        ref={ref}
        data-testid="options"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 1));
          if (i !== index) onIndex(Math.min(day.options.length - 1, Math.max(0, i)));
        }}
        className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]"
      >
        {day.options.map((o, i) => (
          <OptionCard
            key={o.id}
            label={o.label}
            title={o.title}
            description={o.description}
            selected={i === index}
            summary={summary(o)}
            segments={o.blocks.filter((b) => b.type !== "sleep").map((b) => ({ color: typeColor(b.type), weight: 1 }))}
          />
        ))}
      </div>
      <PageDots count={day.options.length} active={index} />
      <div className="sticky bottom-[calc(84px+env(safe-area-inset-bottom))] z-10 md:bottom-4">
        <Button size="lg" className="w-full shadow-calma" onClick={onChoose}>
          Elegir esta
        </Button>
      </div>
    </>
  );
}

function ReviewCard({ day, pending }: { day: Day; pending: number }) {
  const [energy, setEnergy] = useState<number | null>(null);
  const [mood, setMood] = useState<number | null>(null);
  const [text, setText] = useState("");
  const writes = useWrites(day.date);
  return (
    <div className="flex flex-col gap-2">
      <DayReviewCard energy={energy} mood={mood} pending={pending} onChange={(k, v) => (k === "energy" ? setEnergy(v) : setMood(v))} />
      <textarea aria-label="Nota del día" value={text} onChange={(e) => setText(e.target.value)} placeholder="¿Algo para recordar de hoy?" rows={2} className="rounded-lg bg-surface2 px-3.5 py-3 text-[15px] text-text outline-none" />
      <Button size="lg" disabled={!energy || !mood} onClick={() => void writes.send("PATCH", `/api/days/${day.date}`, { review: { energy, mood, text: text.trim() || null } }, "Cierre del día")}>
        Guardar cierre
      </Button>
    </div>
  );
}

function HabitsToday() {
  const habits = useHabits().data?.habits.filter((h) => h.active) ?? [];
  const weekly = habits.filter((h) => h.targetPeriod === "week");
  const daily = habits.filter((h) => h.targetPeriod === "day");
  if (!habits.length) return null;
  return (
    <SectionCard icon="fitness_center" iconColor={typeColor("gym")} title="Hábitos de hoy">
      <div className="flex flex-wrap items-center gap-4">
        {weekly.map((h) => (
          <div key={h.id} className="flex items-center gap-2.5">
            <Ring value={h.period.count} total={h.period.target} size={52} label={`${h.name} ${h.period.count} de ${h.period.target}`} />
            <span className="flex flex-col">
              <span className="text-body-sm text-text">{h.name}</span>
              {h.streak.current > 0 && <span className="text-mono text-muted">{h.streak.current} sem seguidas</span>}
            </span>
          </div>
        ))}
        {daily.map((h) => (
          <div key={h.id} className="flex items-center gap-2">
            <Icon name={h.period.met ? "check_circle" : "radio_button_unchecked"} className={h.period.met ? "text-success" : "text-muted"} />
            <span className="text-body-sm text-text">{h.name}</span>
            {h.streak.current > 1 && <StreakChip count={h.streak.current} />}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
