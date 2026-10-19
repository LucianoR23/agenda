"use client";

import { useState } from "react";
import type { SleepLog } from "@/client/types";
import { typeColor } from "../../block-types";
import { Button } from "../../components/controls";
import { Icon } from "../../components/icon";
import { localHHmm } from "../../format";
import { addDays } from "../../time";

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const field = "h-12 w-full rounded-md border border-border2 bg-surface px-3.5 font-mono text-body text-text outline-none focus:border-accent";

/** Local date+time in Buenos Aires → ISO with -03:00. Bed times before 12:00 are after midnight (next day). */
const iso = (night: string, time: string, kind: "bed" | "wake") => {
  const nextDay = kind === "wake" || time < "12:00";
  return `${nextDay ? addDays(night, 1) : night}T${time}:00-03:00`;
};

/** Manual load / correction of one night ("¿A qué hora te dormiste / levantaste?"). */
export function SleepEditor({ night, log, onSave }: { night: string; log: SleepLog | null; onSave: (body: { bedAt?: string; wokeAt?: string }) => void }) {
  const [bed, setBed] = useState(log?.bedAt ? localHHmm(log.bedAt) : "");
  const [wake, setWake] = useState(log?.wokeAt ? localHHmm(log.wokeAt) : "");
  const ok = (bed === "" || TIME.test(bed)) && (wake === "" || TIME.test(wake)) && (bed !== "" || wake !== "");
  return (
    <div className="flex flex-col gap-3.5">
      <span className="flex items-center gap-2 text-caption text-muted">
        <Icon name="bedtime" size={16} color={typeColor("sleep")} /> Noche del {night.slice(8)}/{night.slice(5, 7)}
      </span>
      <h2 className="text-title text-text">¿Cómo dormiste?</h2>
      <div className="grid grid-cols-2 gap-2.5">
        <label className="flex flex-col gap-1 text-micro text-muted">
          Me dormí
          <input aria-label="Me dormí" inputMode="numeric" placeholder="23:45" value={bed} onChange={(e) => setBed(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1 text-micro text-muted">
          Me levanté
          <input aria-label="Me levanté" inputMode="numeric" placeholder="07:00" value={wake} onChange={(e) => setWake(e.target.value)} className={field} />
        </label>
      </div>
      <p className="text-caption text-muted">Si te dormiste después de medianoche, poné la hora tal cual (00:30).</p>
      <Button size="lg" disabled={!ok} onClick={() => onSave({ ...(bed ? { bedAt: iso(night, bed, "bed") } : {}), ...(wake ? { wokeAt: iso(night, wake, "wake") } : {}) })}>
        Guardar
      </Button>
    </div>
  );
}
