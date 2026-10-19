import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import * as ex from "@/contract/examples";
import { BLOCK_TYPES, typeColor, type BlockTypeKey } from "@/ui/block-types";
import { BlockCard, NowLine, type BlockData } from "@/ui/components/block-card";
import { Button, Fab, FilterChip, PageDots, Ring, Segmented, StatusChip, StreakChip, Toggle } from "@/ui/components/controls";
import { ConflictCompare, DayReviewCard, OutcomePicker, ProposalDiffView, ShiftChooser, SleepCard } from "@/ui/components/extensions";
import { Banner, SyncStatus, Toast } from "@/ui/components/feedback";
import { Icon } from "@/ui/components/icon";
import { DayHeader, TabBar } from "@/ui/components/navigation";
import { PinPad } from "@/ui/components/pin-pad";
import {
  BarChart,
  ChartCard,
  EmptyState,
  HeatCell,
  OptionCard,
  RowGroup,
  SectionCard,
  SettingsRow,
  Sheet,
  SheetRow,
  Sparkline,
  StatCard,
  TimelineSkeleton,
} from "@/ui/components/surfaces";

/** Living version of design/Agenda - Sistema.dc.html, rendered with the real contract examples. Dev only. */
export default function DesignGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="flex flex-col gap-10 bg-[#D9D8D3] p-4 text-[#151613] md:p-12">
      <header className="flex max-w-3xl flex-col gap-2">
        <span className="font-mono text-mono tracking-[.08em] text-[#55574F]">AGENDA · SISTEMA CALMA v0.2 · IMPLEMENTACIÓN</span>
        <h1 className="text-[44px] leading-tight font-semibold tracking-[-.02em]">Componentes</h1>
        <p className="text-[18px] text-[#3C3E38]">Mismo marcado en ambos temas, con los datos de ejemplo del contrato (lunes 19/10).</p>
      </header>
      <div className="flex flex-col gap-8 xl:flex-row xl:items-start">
        <Gallery theme="dark" name="Oscuro" note="TEMA PRIMARIO" />
        <Gallery theme="light" name="Claro" note="MISMO MARCADO" />
      </div>
    </main>
  );
}

function Card({ title, note, children, className }: { title: string; note?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`flex flex-col gap-4 rounded-[24px] border border-border bg-bg p-5 md:p-6 ${className ?? ""}`}>
      <div className="flex flex-col gap-1">
        <h2 className="font-mono text-mono tracking-[.08em] text-muted">{title}</h2>
        {note && <p className="text-body-sm text-text2">{note}</p>}
      </div>
      {children}
    </section>
  );
}

const optionA = ex.dayDraft.options[0];
const blocksA = optionA.blocks;
const find = (pred: (b: BlockData) => boolean) => blocksA.find(pred)!;
const martin = find((b) => b.lead?.name === "Martín Gómez");
const local = find((b) => b.type === "local_work");
const sleep = find((b) => b.type === "sleep");

const SAMPLES: Array<{ cap: string; block: BlockData }> = [
  { cap: "PENDIENTE · AGENBOT", block: ex.blockReadingA },
  { cap: "HECHO", block: ex.blockGymDone },
  { cap: "SALTEADO", block: { ...find((b) => b.title === "Almuerzo"), status: "skipped" } },
  { cap: "CALENDAR · HORA FIJA", block: local },
  { cap: "EDITADO POR VOS", block: ex.blockReadingMoved },
  { cap: "LLAMADA · PENDIENTE", block: martin },
  { cap: "LLAMADA · CON RESULTADO", block: ex.blockMartinDone },
  { cap: "YA NO ESTÁ EN CALENDAR (D31)", block: { ...find((b) => b.lead?.name === "Laura Pérez"), status: "done", outcome: "no_show", removedFromCalendarAt: "2026-10-19T16:00:00.000-03:00" } },
  { cap: "PASA LA MEDIANOCHE (D54)", block: { ...sleep, start: "24:15", end: "07:45", userOverrides: ["start", "end"] } },
];

const segments = (blocks: BlockData[]) =>
  blocks
    .filter((b) => b.type !== "sleep")
    .map((b) => ({ color: typeColor(b.type), weight: 1 }));

function Gallery({ theme, name, note }: { theme: "dark" | "light"; name: string; note: string }) {
  return (
    <div data-theme={theme} className="flex flex-1 flex-col gap-6 rounded-[28px] bg-sunken p-4 md:p-8">
      <div className="flex items-baseline gap-3.5">
        <span className="text-[32px] font-semibold tracking-[-.02em] text-text">{name}</span>
        <span className="font-mono text-mono text-muted">COMPONENTES · {note}</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="BLOQUE DE TIMELINE · ESTADOS" note="Hora · ícono de tipo · título · estado (ícono + texto) · meta · fuente." className="lg:row-span-3">
          {SAMPLES.map((s) => (
            <div key={s.cap} className="flex flex-col gap-1.5">
              <span className="pl-[62px] font-mono text-micro text-muted">{s.cap}</span>
              <BlockCard block={s.block} />
            </div>
          ))}
          <NowLine time="15:12" />
        </Card>

        <Card title="REGISTRO DE TIPOS" note="13 tipos; el color sale del tono con L/C fijos por tema.">
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(BLOCK_TYPES) as BlockTypeKey[]).map((k) => (
              <div key={k} className="flex items-center gap-2.5 rounded-md bg-surface px-3 py-2">
                <span className="flex size-8 items-center justify-center rounded-[9px] bg-surface2">
                  <Icon name={BLOCK_TYPES[k].icon} size={18} color={typeColor(k)} />
                </span>
                <span className="flex flex-col">
                  <span className="text-body-sm text-text">{BLOCK_TYPES[k].label}</span>
                  <span className="font-mono text-micro text-muted">{k}</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="TARJETA DE OPCIÓN · BOTÓN FIJO" note="Carrusel horizontal; la siguiente opción asoma para invitar al swipe.">
          <div className="-mr-5 flex snap-x gap-3 overflow-x-auto pb-1 md:-mr-6">
            <OptionCard label="A" title={optionA.title} description={optionA.description} segments={segments(blocksA)} summary="12 bloques · 2 llamadas · gym ✓" selected />
            <OptionCard label="B" title={ex.dayDraft.options[1].title} description={ex.dayDraft.options[1].description} segments={segments(ex.dayDraft.options[1].blocks)} summary="13 bloques · 2 llamadas · gym ✓" />
          </div>
          <PageDots count={2} active={0} />
          <Button size="lg">Elegir esta</Button>
        </Card>

        <Card title="CONTROLES">
          <div className="flex flex-wrap gap-2">
            <FilterChip selected>Todo</FilterChip>
            <FilterChip>Llamadas</FilterChip>
            <FilterChip>Hábitos</FilterChip>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusChip icon="radio_button_unchecked">Pendiente</StatusChip>
            <StatusChip tone="success" icon="check_circle">Hecho</StatusChip>
            <StatusChip tone="muted" icon="do_not_disturb_on" strike>Salteado</StatusChip>
            <StatusChip icon="event">Calendar</StatusChip>
          </div>
          <Segmented value="week" options={[{ value: "week", label: "Semana" }, { value: "month", label: "Mes" }, { value: "year", label: "Año" }]} />
          <div className="flex flex-wrap items-center gap-5">
            <Ring value={1} total={3} label="Gym 1 de 3 esta semana" />
            <StreakChip count={12} />
            <Toggle checked label="Activado" />
            <Toggle checked={false} label="Desactivado" />
            <Fab label="Agregar bloque" />
          </div>
        </Card>

        <Card title="BOTTOM SHEET · BLOQUE DE CALENDAR" note="La hora no se edita acá; solo estado, resultado y nota." className="lg:row-span-2">
          <div className="overflow-hidden rounded-xl bg-[var(--scrim)] pt-14">
            <Sheet label="Editar bloque">
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-caption text-muted">
                  <Icon name="call" size={16} className="text-call" />
                  Llamada · 10:00–10:45 · <Icon name="event" size={14} /> Calendar
                </span>
                <span className="text-title text-text">Martín Gómez</span>
              </div>
              <Segmented background="bg-bg" value="done" options={[{ value: "pending", label: "Pendiente" }, { value: "done", label: "Hecho", icon: "check" }, { value: "skipped", label: "Salteado" }]} />
              <RowGroup>
                <SheetRow icon="flag" label="Resultado" value="Seguimiento" valueTone="call" chevron />
                <SheetRow icon="notes" label="Agregá una nota…" placeholder />
                <SheetRow icon="notifications" label="Avisarme 10 min antes" trailing={<Toggle checked label="Avisarme 10 min antes" />} />
              </RowGroup>
              <Button variant="ghost" icon="open_in_new" className="justify-start px-0">
                Editar en Google Calendar
              </Button>
              <Button size="lg">Guardar</Button>
            </Sheet>
          </div>
        </Card>

        <Card title="BANNERS · TOAST">
          <Banner kind="info">Agenbot cargó tu día a las 07:00.</Banner>
          <Banner kind="proposal" title="Agenbot propone 1 cambio" action="Ver">
            Mover la llamada con Laura a las 15:00.
          </Banner>
          <Banner kind="offline">Sin conexión. Guardamos tus cambios y los subimos cuando vuelvas.</Banner>
          <Banner kind="conflict" action="Resolver">
            Tu versión y la del servidor no coinciden.
          </Banner>
          <SyncStatus state="syncing" lastSync="15:10" />
          <Toast message="Gym marcado como hecho" action="Deshacer" />
        </Card>

        <Card title="STAT CARD · GRÁFICOS">
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard label="Bloques hechos" value="78%" note="▲ 6 pts vs semana pasada" noteTone="success" />
            <StatCard label="Llamadas cerradas" value="2 / 9" note="esta semana" />
          </div>
          <ChartCard title="Llamadas por día" period="Semana" reading="Lunes 2, martes 1, miércoles 3, jueves 2, viernes 1.">
            <BarChart highlight={2} bars={[["L", 2], ["M", 1], ["M", 3], ["J", 2], ["V", 1], ["S", 0], ["D", 0]].map(([label, value]) => ({ label: String(label), value: Number(value) }))} />
          </ChartCard>
          <ChartCard title="Horas dormidas" period="Semana" reading="Promedio 6 h 58 min.">
            <Sparkline color={typeColor("sleep")} values={[425, 395, 440, 410, 380, 455, 410]} />
          </ChartCard>
          <div className="grid grid-cols-14 gap-1">
            {[0, 0.25, 0.5, 0.75, 1, 0.5, null, 0.25, 1, 0.75, 0.5, 0, 0.25, 0.75].map((v, i) => (
              <HeatCell key={i} value={v} label={`Día ${i + 1}`} />
            ))}
          </div>
        </Card>

        <Card title="VACÍO · CARGANDO" note="'Armar mi día' crea un día propio (D60).">
          <EmptyState
            icon="schedule"
            title="Agenbot todavía no cargó tu día"
            body="Suele llegar a las 07:00. Podés esperarlo o armarlo vos."
            actions={
              <>
                <Button>Armar mi día</Button>
                <Button variant="secondary">Reintentar</Button>
              </>
            }
          />
          <TimelineSkeleton />
        </Card>

        <Card title="TECLADO PIN" note="6 dígitos (spec); huella primero cuando está activada.">
          <PinPad filled={2} fingerprint />
        </Card>

        <Card title="NAVEGACIÓN">
          <DayHeader label="Lunes 19" />
          <div className="overflow-hidden rounded-lg border border-border">
            <TabBar active="today" />
          </div>
        </Card>

        <Card title="PATRONES · AJUSTES">
          <SectionCard icon="fitness_center" iconColor={typeColor("gym")} title="Hábitos de hoy" action="Ver todo">
            <div className="flex items-center gap-4">
              <Ring value={1} total={3} />
              <StreakChip count={5} unit="semanas" />
            </div>
          </SectionCard>
          <RowGroup>
            <SettingsRow icon="lock" title="Seguridad" subtitle="PIN, huella, dispositivos" />
            <SettingsRow icon="auto_awesome" title="Agenbot" subtitle="Carga diaria a las 07:00" value="Activo" />
            <SettingsRow icon="bedtime" title="Sueño" subtitle="Recordatorio a las 10:00 si falta cargar" value="Activo" />
          </RowGroup>
        </Card>

        <Card title="EXTENSIÓN · SUEÑO" note="No está en el diseño: tarjeta en Hoy con botones y recordatorio (D55–D58).">
          <SleepCard mode="morning" previousNight={{ ...ex.sleepPrevNight, wokeAt: null, wakeSource: null, durationMinutes: null }} night={null} />
          <SleepCard mode="morning" previousNight={ex.sleepPrevNight} night={null} />
          <SleepCard mode="night" previousNight={ex.sleepPrevNight} night={null} />
          <SleepCard mode="night" previousNight={ex.sleepPrevNight} night={ex.sleepTonightBed} />
        </Card>

        <Card title="EXTENSIÓN · PROPUESTA DE AGENBOT" note="Diff agregado / quitado / movido / conservado.">
          <ProposalDiffView reason={ex.proposalPending.reason} diff={ex.proposalPending.diff} />
        </Card>

        <Card title="EXTENSIÓN · ME ATRASÉ">
          <ShiftChooser value={30} fromTime="21:00" affected={2} />
        </Card>

        <Card title="EXTENSIÓN · CONFLICTO · RESULTADO">
          <ConflictCompare field="Lectura · horario" mine="11:15–11:45" server="14:00–14:30" />
          <OutcomePicker value="follow_up" />
        </Card>

        <Card title="EXTENSIÓN · CIERRE DEL DÍA">
          <DayReviewCard energy={4} mood={null} pending={2} />
        </Card>
      </div>
    </div>
  );
}
