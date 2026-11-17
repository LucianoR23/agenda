/**
 * Quick add ("+"): turns Rioplatense Spanish into a task draft, locally and instantly. Everything it understood is
 * shown as editable chips before saving; whatever it didn't understand stays in the title.
 *
 *   "mañana 9 llamar al contador"              → tomorrow 09:00
 *   "el jueves a las 18 pagar luz #casa !alta" → Thursday 18:00, list Casa, priority high
 *   "todos los lunes 8:30 sacar la basura"     → every Monday 08:30, first one next Monday (or today)
 *   "15/12 cumple Ana"                         → December 15
 *   "+trabajo informe"                         → tag "trabajo"
 */

export interface QuickDraft {
  title: string;
  dueDate: string | null;
  dueTime: string | null;
  rrule: string | null;
  /** `#nombre` as typed; matched to a list by the caller. */
  listName: string | null;
  priority: number | null;
  tags: string[];
}

const WEEKDAYS: Record<string, number> = {
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
  domingo: 7,
};
const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};
const PRIORITY: Record<string, number> = { alta: 3, media: 2, baja: 1 };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const pad = (n: number) => String(n).padStart(2, "0");
const plain = (iso: string) => Temporal.PlainDate.from(iso);

/** Next date (strictly after `today`) that falls on ISO weekday `dow`. */
const nextWeekday = (today: string, dow: number) => {
  const d = plain(today);
  return d.add({ days: (dow - d.dayOfWeek + 7) % 7 || 7 }).toString();
};
/** Today if it's that weekday, else the next one (first occurrence of a recurrence). */
const thisOrNextWeekday = (today: string, dow: number) => {
  const d = plain(today);
  return d.add({ days: (dow - d.dayOfWeek + 7) % 7 }).toString();
};

const validDate = (y: number, m: number, d: number) => {
  try {
    return Temporal.PlainDate.from({ year: y, month: m, day: d }, { overflow: "reject" }).toString();
  } catch {
    return null;
  }
};

/** A day/month without a year: this year, or next year if it already passed. */
function dayMonth(today: string, d: number, m: number, y?: number): string | null {
  if (y !== undefined) return validDate(y < 100 ? 2000 + y : y, m, d);
  const t = plain(today);
  const thisYear = validDate(t.year, m, d);
  if (thisYear && thisYear >= today) return thisYear;
  return validDate(t.year + 1, m, d);
}

const time = (h: number, min = 0) => (h >= 0 && h <= 23 && min >= 0 && min <= 59 ? `${pad(h)}:${pad(min)}` : null);

/** Parses a quick-add line. `today` is the user's local date (YYYY-MM-DD). */
export function parseQuickAdd(input: string, today: string): QuickDraft {
  const draft: QuickDraft = { title: "", dueDate: null, dueTime: null, rrule: null, listName: null, priority: null, tags: [] };
  // NFC so that folding (which drops accents) keeps the same string length and match indexes line up
  let text = ` ${input.normalize("NFC").trim()} `;
  let dateAt = -1; // where the date words were, for "mañana 9" (a bare hour right after them)
  const cut = (re: RegExp, on: (m: RegExpMatchArray) => boolean | undefined): number => {
    const m = fold(text).match(re);
    if (!m || m.index === undefined) return -1;
    if (on(m) === false) return -1;
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`;
    return m.index;
  };

  // markers: #list, !priority, +tag (keep original casing for the list name and tags)
  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (_, name: string) => {
    draft.listName ??= name;
    return " ";
  });
  text = text.replace(/\s!(alta|media|baja)\b/giu, (_, p: string) => {
    draft.priority = PRIORITY[fold(p)] ?? null;
    return " ";
  });
  text = text.replace(/\s\+([\p{L}\p{N}_-]+)/gu, (_, tag: string) => {
    if (!draft.tags.includes(tag.toLowerCase())) draft.tags.push(tag.toLowerCase());
    return " ";
  });

  // recurrence
  cut(/\s(?:todos los dias|cada dia|diariamente)\s/, () => {
    draft.rrule = "FREQ=DAILY";
    draft.dueDate = today;
    return true;
  });
  cut(/\s(?:dias de semana|de lunes a viernes|todos los dias habiles)\s/, () => {
    draft.rrule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    const d = plain(today);
    draft.dueDate = d.dayOfWeek <= 5 ? today : thisOrNextWeekday(today, 1);
    return true;
  });
  cut(
    /\s(?:todos los|todas las|cada) (lunes|martes|miercoles|jueves|viernes|sabados?|domingos?)(?: y (lunes|martes|miercoles|jueves|viernes|sabados?|domingos?))?\s/,
    (m) => {
      // "sábados"/"domingos" are plural; "lunes"…"viernes" already end in s
      const days = [m[1], m[2]].filter(Boolean).map((w) => WEEKDAYS[(w as string).replace(/^(sabado|domingo)s$/, "$1")] as number);
      draft.rrule = `FREQ=WEEKLY;BYDAY=${days.map((d) => BYDAY[d - 1]).join(",")}`;
      draft.dueDate = days.map((d) => thisOrNextWeekday(today, d)).sort()[0] ?? null;
      return true;
    },
  );
  cut(/\s(?:todas las semanas|cada semana|semanalmente)\s/, () => {
    draft.rrule = "FREQ=WEEKLY";
    draft.dueDate ??= today;
    return true;
  });
  cut(/\s(?:todos los meses|cada mes|mensualmente)\s/, () => {
    draft.rrule = "FREQ=MONTHLY";
    draft.dueDate ??= today;
    return true;
  });
  cut(/\s(?:todos los anos|cada ano|anualmente)\s/, () => {
    draft.rrule = "FREQ=YEARLY";
    draft.dueDate ??= today;
    return true;
  });

  // explicit dates (a recurrence's first date can still be overridden by an explicit one)
  let dated = false;
  const setDate = (d: string | null) => {
    if (!d) return false;
    draft.dueDate = d;
    dated = true;
    return true;
  };
  const dateCut = (re: RegExp, on: (m: RegExpMatchArray) => boolean | undefined) => {
    if (dated) return;
    const at = cut(re, on);
    if (at >= 0) dateAt = at;
  };
  dateCut(/\spasado manana\s/, () => setDate(plain(today).add({ days: 2 }).toString()));
  dateCut(/\smanana\s/, () => setDate(plain(today).add({ days: 1 }).toString()));
  dateCut(/\shoy\s/, () => setDate(today));
  dateCut(/\s(?:el |este |proximo |el proximo )?(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s/, (m) =>
    setDate(nextWeekday(today, WEEKDAYS[m[1] as string] as number)),
  );
  dateCut(/\s(?:el )?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, (m) =>
    setDate(dayMonth(today, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined)),
  );
  dateCut(
    /\s(?:el )?(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s/,
    (m) => setDate(dayMonth(today, Number(m[1]), MONTHS[m[2] as string] as number)),
  );
  dateCut(/\sen (\d{1,2}|un|una) (dias?|semanas?)\s/, (m) => {
    const n = m[1] === "un" || m[1] === "una" ? 1 : Number(m[1]);
    return setDate(
      plain(today)
        .add((m[2] as string).startsWith("semana") ? { weeks: n } : { days: n })
        .toString(),
    );
  });

  // time: "a las 18", "a las 18:30", "18:30", "9hs", "9 hs", and a bare hour right after a date word
  const setTime = (t: string | null) => {
    if (!t) return false;
    draft.dueTime = t;
    return true;
  };
  cut(/\s(?:a las |a la )(\d{1,2})(?:[:.](\d{2}))?(?: ?hs?)?\s/, (m) => setTime(time(Number(m[1]), Number(m[2] ?? 0))));
  if (!draft.dueTime) cut(/\s(\d{1,2})[:.](\d{2})(?: ?hs?)?\s/, (m) => setTime(time(Number(m[1]), Number(m[2]))));
  if (!draft.dueTime) cut(/\s(\d{1,2}) ?hs?\s/, (m) => setTime(time(Number(m[1]))));
  if (!draft.dueTime && dateAt >= 0) {
    const m = text.slice(dateAt).match(/^\s+(\d{1,2})\s/);
    const t = m ? time(Number(m[1])) : null;
    if (m && t) {
      draft.dueTime = t;
      text = `${text.slice(0, dateAt)} ${text.slice(dateAt + m[0].length)}`;
    }
  }

  // a time alone means today
  if (draft.dueTime && !draft.dueDate) draft.dueDate = today;

  draft.title = text.replace(/\s+/g, " ").trim();
  return draft;
}
