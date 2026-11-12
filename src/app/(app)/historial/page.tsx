import { PlaceholderScreen } from "@/ui/screens/placeholder";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <PlaceholderScreen title="Historial" icon="calendar_month" body="El historial y el cierre del día llegan en la fase 7." />;
}
