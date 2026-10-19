import * as ex from "@/contract/examples";
import { agent, setNow, setupUser } from "./api";

export const DATE = "2026-10-19";
export const D = `/api/days/${DATE}`;
export const MARTIN = "4f2k9q0d1m7b8s6t3u1v0a2c3e";
export const LAURA = "7h3n1p5r8s2t4v6x9z0b1d3f5g";

type Block = { id: string; title: string; type: string; externalId: string | null; start: string; end: string | null; [k: string]: unknown };
type Day = { version: number; status: string; options: Array<{ label: string; blocks: Block[] }>; [k: string]: unknown };

export const opt = (day: Day, label = "A") => day.options.find((o) => o.label === label)!;
export const blockOf = (day: Day, pred: (b: Block) => boolean, label = "A") => opt(day, label).blocks.find(pred)!;
export const byTitle = (title: string) => (b: Block) => b.title === title;
export const byExt = (id: string) => (b: Block) => b.externalId === id;
export const byType = (t: string) => (b: Block) => b.type === t;

/** 07:00 load by the agent. */
export async function load(input = ex.dayInput0700) {
  setNow("2026-10-19T07:00:00-03:00");
  const r = await agent().put(D, input);
  if (r.status !== 201) throw new Error(`load failed ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.day as Day;
}

/** 07:00 load, then I set up the app and choose option A at 07:42. */
export async function loadAndChoose(label = "A") {
  await load();
  const { user, recoveryCodes } = await setupUser();
  setNow("2026-10-19T07:42:00-03:00");
  const r = await user.post(`${D}/choose`, { option: label });
  if (r.status !== 200) throw new Error(`choose failed ${r.status}`);
  return { user, day: r.body as Day, recoveryCodes };
}

/** The agent's re-plan body: Laura moved to 15:00, reading moved to 14:00 (only option A). */
export const replan = (extra: Partial<typeof ex.dayInputReplan> = {}) => ({ ...ex.dayInputReplan, ...extra });
