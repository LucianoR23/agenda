/**
 * Realistic example data for the OpenAPI spec and docs/api-examples.md.
 * Every example is validated against its schema when the spec is generated.
 * Scenario: Monday 2026-10-19, Agenbot loads the day at 07:00 with options A and B.
 */
import type { z } from "./zod";
import type {
  Block,
  BlockInput,
  Day,
  DayInput,
  HabitLog,
  PlanOption,
  Proposal,
  Task,
} from "./planning";
import type { SleepLog } from "./sleep";

type BlockT = z.infer<typeof Block>;
type BlockInputT = z.infer<typeof BlockInput>;
type DayT = z.infer<typeof Day>;
type TaskT = z.infer<typeof Task>;

export const DATE = "2026-10-19";
const T0700 = "2026-10-19T07:00:04.812-03:00";
const T0742 = "2026-10-19T07:42:10.002-03:00";

/** Deterministic UUIDv7-shaped ids for examples. */
export const uid = (n: number) => `019a0a6e-1c00-7000-8000-${n.toString(16).padStart(12, "0")}`;

// ---------- the agent's 07:00 PUT body ----------

const calendarBlocks: BlockInputT[] = [
  {
    source: "calendar",
    externalId: "4f2k9q0d1m7b8s6t3u1v0a2c3e",
    externalUrl: "https://www.google.com/calendar/event?eid=NGYyazlxMGQxbTdiOHM2dDN1MXYwYTJjM2U",
    calendar: "work",
    start: "10:00",
    end: "10:45",
    type: "call",
    title: "Llamada de cierre",
    detail: "Programa de 12 semanas · 2ª llamada",
    lead: {
      name: "Martín Gómez",
      phone: "+5491155550101",
      whatsapp: "5491155550101",
      notes: "Coach online, factura ~4k USD/mes, quiere llegar a 10k. Objeción en la llamada de descubrimiento: precio.",
      crmUrl: "https://crm.example.com/leads/8812",
    },
  },
  {
    source: "calendar",
    externalId: "7h3n1p5r8s2t4v6x9z0b1d3f5g",
    externalUrl: "https://www.google.com/calendar/event?eid=N2gzbjFwNXI4czJ0NHY2eDl6MGIxZDNmNWc",
    calendar: "work",
    start: "14:00",
    end: "14:45",
    type: "call",
    title: "Primera llamada",
    lead: {
      name: "Laura Pérez",
      whatsapp: "5493515550202",
      notes: "Personal trainer presencial, quiere pasar a online. Primera llamada.",
    },
  },
  {
    source: "calendar",
    externalId: "2a4c6e8g0i2k4m6o8q0s2u4w6y",
    externalUrl: "https://www.google.com/calendar/event?eid=MmE0YzZlOGcwaTJrNG02bzhxMHMydTR3Nnk",
    calendar: "work",
    start: "16:00",
    end: "20:00",
    type: "local_work",
    title: "Turno en el local",
  },
  {
    source: "calendar",
    externalId: "9b8c7d6e5f4g3h2i1j0k9l8m7n",
    externalUrl: "https://www.google.com/calendar/event?eid=OWI4YzdkNmU1ZjRnM2gyaTFqMGs5bDhtN24",
    calendar: "personal",
    start: "20:30",
    end: "21:30",
    type: "padel",
    title: "Clase de pádel",
  },
];

const agentCommon: BlockInputT[] = [
  { source: "agent", start: "07:15", end: "07:45", type: "dogs", title: "Paseo con las perras" },
  { source: "agent", start: "08:00", end: "08:30", type: "meal", title: "Desayuno" },
  { source: "agent", start: "09:00", end: "09:50", type: "study", title: "Repasar guion de cierre", detail: "Objeción de precio: practicar reencuadre de inversión." },
  { source: "agent", start: "11:00", end: "11:30", type: "reading", title: "Lectura (30 min)" },
  { source: "agent", start: "21:45", end: "22:45", type: "partner", title: "Tiempo en pareja" },
  { source: "agent", start: "23:30", end: "07:00", type: "sleep", title: "Dormir" },
];

export const dayInput0700: z.infer<typeof DayInput> = {
  callsSummary: "2 llamadas: Martín (cierre, objeción precio) 10:00 y Laura (primera llamada) 14:00.",
  weeklyGym: { done: 0, target: 3 },
  notes: "Turno en el local 16–20: no hay hueco para gym a la tarde.",
  options: [
    {
      label: "A",
      title: "Gym al mediodía",
      description: "Gym entre la llamada de Martín y la de Laura; lectura temprano.",
      blocks: [
        ...calendarBlocks,
        ...agentCommon,
        { source: "agent", start: "12:00", end: "13:00", type: "gym", title: "Gym — tren superior" },
        { source: "agent", start: "13:10", end: "13:40", type: "meal", title: "Almuerzo" },
      ],
    },
    {
      label: "B",
      title: "Gym temprano",
      description: "Gym antes de los perros; mediodía libre para preparar a Laura.",
      blocks: [
        ...calendarBlocks,
        { source: "agent", start: "06:15", end: "07:05", type: "gym", title: "Gym — tren superior" },
        ...agentCommon,
        { source: "agent", start: "12:30", end: "13:15", type: "meal", title: "Almuerzo" },
        { source: "agent", start: "13:15", end: "13:45", type: "study", title: "Preparar llamada con Laura" },
      ],
    },
  ],
  tasks: [
    { title: "Confirmar por WhatsApp a Martín (10:00)", kind: "whatsapp_confirm", relatedExternalId: "4f2k9q0d1m7b8s6t3u1v0a2c3e" },
    { title: "Confirmar por WhatsApp a Laura (14:00)", kind: "whatsapp_confirm", relatedExternalId: "7h3n1p5r8s2t4v6x9z0b1d3f5g" },
    { title: "Leer notas de descubrimiento de Martín en el CRM", kind: "lead_context" },
    { title: "Seguimiento a Diego (pidió propuesta el viernes)", kind: "follow_up" },
  ],
};

// ---------- materialized resources ----------

const DAY_ID = uid(1);
const OPT_A = uid(2);
const OPT_B = uid(3);
let nextId = 100;

function materializeBlock(b: BlockInputT, optionId: string, order: number, at = T0700): BlockT {
  return {
    id: b.id ?? uid(nextId++),
    optionId,
    start: b.start,
    end: b.end ?? null,
    title: b.title,
    type: b.type,
    detail: b.detail ?? null,
    lead: b.lead ?? null,
    source: b.source,
    externalId: b.externalId ?? null,
    externalUrl: b.externalUrl ?? null,
    calendar: b.calendar ?? null,
    removedFromCalendarAt: null,
    status: "pending",
    statusAt: null,
    outcome: null,
    note: null,
    locked: false,
    remind: b.type === "call",
    userOverrides: [],
    order: b.order ?? order,
    version: 1,
    createdAt: at,
    updatedAt: at,
    updatedBy: "agent",
  };
}

const byStart = (a: BlockT, b: BlockT) => a.start.localeCompare(b.start) || a.order - b.order;

function materializeOption(id: string, input: z.infer<typeof DayInput>["options"][number], order: number): z.infer<typeof PlanOption> {
  return {
    id,
    label: input.label,
    title: input.title,
    description: input.description ?? null,
    order,
    blocks: input.blocks.map((b, i) => materializeBlock(b, id, i)).sort(byStart),
    version: 1,
    createdAt: T0700,
    updatedAt: T0700,
    updatedBy: "agent",
  };
}

const optionA = materializeOption(OPT_A, dayInput0700.options[0], 0);
const optionB = materializeOption(OPT_B, dayInput0700.options[1], 1);

const findBlock = (opt: z.infer<typeof PlanOption>, title: string) => {
  const b = opt.blocks.find((x) => x.title === title);
  if (!b) throw new Error(`example block not found: ${title}`);
  return b;
};

export const blockMartinA = optionA.blocks.find((b) => b.lead?.name === "Martín Gómez")!;
export const blockGymA = findBlock(optionA, "Gym — tren superior");
export const blockReadingA = findBlock(optionA, "Lectura (30 min)");
export const blockDogsA = findBlock(optionA, "Paseo con las perras");

export const tasks0700: TaskT[] = dayInput0700.tasks!.map((t, i) => ({
  id: uid(200 + i),
  date: DATE,
  title: t.title,
  kind: t.kind ?? "other",
  origin: "agent",
  done: false,
  doneAt: null,
  relatedBlockId: t.relatedExternalId ? optionA.blocks.find((b) => b.externalId === t.relatedExternalId)!.id : null,
  order: i,
  version: 1,
  createdAt: T0700,
  updatedAt: T0700,
  updatedBy: "agent",
}));

export const habitLogGym: z.infer<typeof HabitLog> = {
  id: uid(300),
  habitId: uid(400),
  habitSlug: "gym",
  date: DATE,
  done: true,
  value: null,
  source: "user",
  version: 1,
  createdAt: "2026-10-19T13:02:41.300-03:00",
  updatedAt: "2026-10-19T13:02:41.300-03:00",
  updatedBy: "user",
};

/** Night of Sunday 18 → Monday 19, loaded with the quick buttons. */
export const sleepPrevNight: z.infer<typeof SleepLog> = {
  id: uid(350),
  date: "2026-10-18",
  bedAt: "2026-10-19T00:05:00.000-03:00",
  bedSource: "user",
  wokeAt: "2026-10-19T06:55:00.000-03:00",
  wakeSource: "user",
  durationMinutes: 410,
  plannedStart: "23:30",
  plannedEnd: "07:00",
  bedDelayMinutes: 35,
  note: null,
  version: 2,
  createdAt: "2026-10-19T00:05:00.000-03:00",
  updatedAt: "2026-10-19T06:55:00.000-03:00",
  updatedBy: "user",
};

/** Tonight: I tapped "Me voy a dormir" at 00:20 (after midnight, so it belongs to the night of the 19th). */
export const sleepTonightBed: z.infer<typeof SleepLog> = {
  id: uid(351),
  date: DATE,
  bedAt: "2026-10-20T00:20:00.000-03:00",
  bedSource: "user",
  wokeAt: null,
  wakeSource: null,
  durationMinutes: null,
  plannedStart: "23:30",
  plannedEnd: "07:00",
  bedDelayMinutes: 50,
  note: null,
  version: 1,
  createdAt: "2026-10-20T00:20:00.000-03:00",
  updatedAt: "2026-10-20T00:20:00.000-03:00",
  updatedBy: "user",
};

/** Day right after the 07:00 PUT (draft). */
export const dayDraft: DayT = {
  id: DAY_ID,
  date: DATE,
  status: "draft",
  chosenOptionId: null,
  chosenOption: null,
  notes: dayInput0700.notes ?? null,
  callsSummary: dayInput0700.callsSummary ?? null,
  weeklyGym: dayInput0700.weeklyGym ?? null,
  review: null,
  reviewedAt: null,
  closedAt: null,
  options: [optionA, optionB],
  tasks: tasks0700,
  habitLogs: [],
  pendingProposal: null,
  sleep: { night: null, previousNight: sleepPrevNight },
  version: 1,
  createdAt: T0700,
  updatedAt: T0700,
  updatedBy: "agent",
};

/** Day after I chose option A at 07:42. */
export const dayChosen: DayT = {
  ...dayDraft,
  status: "chosen",
  chosenOptionId: OPT_A,
  chosenOption: "A",
  version: 2,
  updatedAt: T0742,
  updatedBy: "user",
};

/** Martín's call after I marked it done with outcome follow_up. */
export const blockMartinDone: BlockT = {
  ...blockMartinA,
  status: "done",
  statusAt: "2026-10-19T10:48:03.551-03:00",
  outcome: "follow_up",
  note: "Le interesa, pide hablar con la pareja. Volver a llamar el jueves 18:00.",
  version: 2,
  updatedAt: "2026-10-19T10:48:03.551-03:00",
  updatedBy: "user",
};

/** Reading block I moved from 11:00 to 11:15 (now in userOverrides). */
export const blockReadingMoved: BlockT = {
  ...blockReadingA,
  start: "11:15",
  end: "11:45",
  userOverrides: ["start", "end"],
  version: 2,
  updatedAt: "2026-10-19T10:50:12.000-03:00",
  updatedBy: "user",
};

export const blockGymDone: BlockT = {
  ...blockGymA,
  status: "done",
  statusAt: "2026-10-19T13:02:41.300-03:00",
  version: 2,
  updatedAt: "2026-10-19T13:02:41.300-03:00",
  updatedBy: "user",
};

// ---------- 12:30 re-plan: I moved Laura's call to 15:00 in Google → agent PUT → proposal ----------

export const dayInputReplan: z.infer<typeof DayInput> = {
  ...dayInput0700,
  reason: "La llamada con Laura pasó a las 15:00 en Google Calendar; muevo la lectura a las 14:00.",
  options: [
    {
      ...dayInput0700.options[0],
      blocks: dayInput0700.options[0].blocks.map((b) =>
        b.externalId === "7h3n1p5r8s2t4v6x9z0b1d3f5g"
          ? { ...b, start: "15:00", end: "15:45" }
          : b.title === "Lectura (30 min)"
            ? { ...b, id: blockReadingA.id, start: "14:00", end: "14:30" }
            : b,
      ),
    },
  ],
};

const ref = (b: BlockT) => ({ id: b.id, externalId: b.externalId, title: b.title, type: b.type, start: b.start, end: b.end });
const blockLauraA = optionA.blocks.find((b) => b.externalId === "7h3n1p5r8s2t4v6x9z0b1d3f5g")!;

export const proposalPending: z.infer<typeof Proposal> = {
  id: uid(500),
  date: DATE,
  status: "pending",
  reason: dayInputReplan.reason ?? null,
  baseDayVersion: 4,
  createdAt: "2026-10-19T12:30:09.004-03:00",
  resolvedAt: null,
  diff: {
    option: "A",
    added: [],
    removed: [],
    keptRemovedFromCalendar: [],
    moved: [
      { block: ref(blockLauraA), from: { start: "14:00", end: "14:45" }, to: { start: "15:00", end: "15:45" } },
    ],
    changed: [],
    preservedOverrides: [{ block: ref(blockReadingMoved), fields: ["start", "end"] }],
    dayFields: {},
  },
  payload: dayInputReplan,
};

/** Day at 12:35: chosen A → edited (I moved reading), Martín done, 1 task done, pending proposal. v2 choose, v3 Martín, v4 reading. */
export const dayEditedWithProposal: DayT = {
  ...dayChosen,
  status: "edited",
  options: [
    {
      ...optionA,
      blocks: optionA.blocks
        .map((b) =>
          b.id === blockMartinA.id ? blockMartinDone : b.id === blockReadingA.id ? blockReadingMoved : b,
        )
        .sort(byStart),
    },
    optionB,
  ],
  tasks: tasks0700.map((t, i) =>
    i === 0 ? { ...t, done: true, doneAt: "2026-10-19T08:05:00.000-03:00", version: 2, updatedAt: "2026-10-19T08:05:00.000-03:00", updatedBy: "user" } : t,
  ),
  pendingProposal: proposalPending,
  version: 4,
  updatedAt: "2026-10-19T10:50:12.000-03:00",
};

/** After I accept at 12:41: Laura moved to 15:00, my reading override (11:15) preserved, tracking preserved. */
export const dayAfterAccept: DayT = {
  ...dayEditedWithProposal,
  options: dayEditedWithProposal.options.map((o) =>
    o.label !== "A"
      ? o
      : {
          ...o,
          blocks: o.blocks
            .map((b) =>
              b.id === blockLauraA.id
                ? { ...b, start: "15:00", end: "15:45", version: 2, updatedAt: "2026-10-19T12:41:30.120-03:00", updatedBy: "agent" as const }
                : b,
            )
            .sort(byStart),
        },
  ),
  pendingProposal: null,
  version: 5,
  updatedAt: "2026-10-19T12:41:30.120-03:00",
  updatedBy: "user",
};

export const proposalAccepted: z.infer<typeof Proposal> = {
  ...proposalPending,
  status: "accepted",
  resolvedAt: "2026-10-19T12:41:30.120-03:00",
};

export const T = { T0700, T0742 };
