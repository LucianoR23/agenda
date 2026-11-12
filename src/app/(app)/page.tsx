import { PlaceholderScreen } from "@/ui/screens/placeholder";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <PlaceholderScreen title="Hoy" icon="today" body="Acá van a estar tus tareas, recordatorios y eventos del día." />;
}
