import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Button, Fab, FilterChip, Ring, Segmented, StatusChip, StreakChip, Toggle } from "@/ui/components/controls";
import { ConflictCompare, DayReviewCard } from "@/ui/components/extensions";
import { Banner, SyncStatus, Toast } from "@/ui/components/feedback";
import { Icon } from "@/ui/components/icon";
import { DayHeader, TabBar } from "@/ui/components/navigation";
import { PinPad } from "@/ui/components/pin-pad";
import {
  BarChart,
  ChartCard,
  EmptyState,
  HeatCell,
  RowGroup,
  SectionCard,
  SettingsRow,
  Sheet,
  SheetRow,
  Sparkline,
  StatCard,
  TimelineSkeleton,
} from "@/ui/components/surfaces";

/** Living version of design/Agenda - Sistema.dc.html (Sistema Calma components in both themes). Dev only. */
export default function DesignGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="flex flex-col gap-10 bg-[#D9D8D3] p-4 text-[#151613] md:p-12">
      <header className="flex max-w-3xl flex-col gap-2">
        <span className="font-mono text-mono tracking-[.08em] text-[#55574F]">AGENDA · SISTEMA CALMA v0.2 · IMPLEMENTACIÓN</span>
        <h1 className="text-[44px] leading-tight font-semibold tracking-[-.02em]">Componentes</h1>
        <p className="text-[18px] text-[#3C3E38]">Mismo marcado en ambos temas.</p>
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

function Gallery({ theme, name, note }: { theme: "dark" | "light"; name: string; note: string }) {
  return (
    <div data-theme={theme} className="flex flex-1 flex-col gap-6 rounded-[28px] bg-sunken p-4 md:p-8">
      <div className="flex items-baseline gap-3.5">
        <span className="text-[32px] font-semibold tracking-[-.02em] text-text">{name}</span>
        <span className="font-mono text-mono text-muted">COMPONENTES · {note}</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="CONTROLES">
          <div className="flex flex-wrap gap-2">
            <FilterChip selected>Todo</FilterChip>
            <FilterChip>Inbox</FilterChip>
            <FilterChip>Hoy</FilterChip>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusChip icon="radio_button_unchecked">Pendiente</StatusChip>
            <StatusChip tone="success" icon="check_circle">Hecho</StatusChip>
            <StatusChip tone="muted" icon="do_not_disturb_on" strike>Descartada</StatusChip>
            <StatusChip icon="event">Calendar</StatusChip>
          </div>
          <Segmented value="week" options={[{ value: "week", label: "Semana" }, { value: "month", label: "Mes" }, { value: "year", label: "Año" }]} />
          <div className="flex flex-wrap items-center gap-5">
            <Ring value={1} total={3} label="Gym 1 de 3 esta semana" />
            <StreakChip count={12} />
            <Toggle checked label="Activado" />
            <Toggle checked={false} label="Desactivado" />
            <Fab label="Agregar tarea" />
          </div>
        </Card>

        <Card title="BOTTOM SHEET" note="Hoja de edición con filas y acción principal.">
          <div className="overflow-hidden rounded-xl bg-[var(--scrim)] pt-14">
            <Sheet label="Editar tarea">
              <span className="text-title text-text">Pagar la luz</span>
              <Segmented background="bg-bg" value="pending" options={[{ value: "pending", label: "Pendiente" }, { value: "done", label: "Hecha", icon: "check" }]} />
              <RowGroup>
                <SheetRow icon="event" label="Vence" value="Hoy 18:00" chevron />
                <SheetRow icon="notes" label="Agregá una nota…" placeholder />
                <SheetRow icon="notifications" label="Recordarme" trailing={<Toggle checked label="Recordarme" />} />
              </RowGroup>
              <Button size="lg">Guardar</Button>
            </Sheet>
          </div>
        </Card>

        <Card title="BANNERS · TOAST">
          <Banner kind="info">Sunday agregó 2 tareas a tu Inbox.</Banner>
          <Banner kind="offline">Sin conexión. Guardamos tus cambios y los subimos cuando vuelvas.</Banner>
          <Banner kind="conflict" action="Resolver">
            Tu versión y la del servidor no coinciden.
          </Banner>
          <SyncStatus state="syncing" lastSync="15:10" />
          <Toast message="Tarea hecha" action="Deshacer" />
        </Card>

        <Card title="STAT CARD · GRÁFICOS">
          <div className="grid grid-cols-2 gap-2.5">
            <StatCard label="Tareas hechas" value="78%" note="▲ 6 pts vs semana pasada" noteTone="success" />
            <StatCard label="Recordatorios" value="9" note="esta semana" />
          </div>
          <ChartCard title="Tareas por día" period="Semana" reading="Lunes 2, martes 1, miércoles 3, jueves 2, viernes 1.">
            <BarChart highlight={2} bars={[["L", 2], ["M", 1], ["M", 3], ["J", 2], ["V", 1], ["S", 0], ["D", 0]].map(([label, value]) => ({ label: String(label), value: Number(value) }))} />
          </ChartCard>
          <ChartCard title="Horas dormidas" period="Semana" reading="Promedio 6 h 58 min.">
            <Sparkline color="var(--accent)" values={[425, 395, 440, 410, 380, 455, 410]} />
          </ChartCard>
          <div className="grid grid-cols-14 gap-1">
            {[0, 0.25, 0.5, 0.75, 1, 0.5, null, 0.25, 1, 0.75, 0.5, 0, 0.25, 0.75].map((v, i) => (
              <HeatCell key={i} value={v} label={`Día ${i + 1}`} />
            ))}
          </div>
        </Card>

        <Card title="VACÍO · CARGANDO">
          <EmptyState icon="schedule" title="Nada para hoy" body="Agregá una tarea o pedíselo a Sunday." actions={<Button>Agregar tarea</Button>} />
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
          <SectionCard icon="fitness_center" title="Hábitos de hoy" action="Ver todo">
            <div className="flex items-center gap-4">
              <Ring value={1} total={3} />
              <StreakChip count={5} unit="semanas" />
            </div>
          </SectionCard>
          <RowGroup>
            <SettingsRow icon="lock" title="Seguridad" subtitle="PIN, huella, dispositivos" />
            <SettingsRow icon="notifications" title="Notificaciones" subtitle="Recordatorios en este dispositivo" value="Activas" />
          </RowGroup>
        </Card>

        <Card title="EXTENSIÓN · CONFLICTO">
          <ConflictCompare field="Pagar la luz · vence" mine="Hoy 18:00" server="Mañana 10:00" />
        </Card>

        <Card title="EXTENSIÓN · CIERRE DEL DÍA">
          <DayReviewCard energy={4} mood={null} pending={2} />
        </Card>
      </div>
    </div>
  );
}
