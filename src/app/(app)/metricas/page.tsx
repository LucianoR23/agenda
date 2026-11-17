import { redirect } from "next/navigation";

/** Historial y métricas are one screen (docs/v2/01). */
export default function Page() {
  redirect("/historial?tab=metricas");
}
