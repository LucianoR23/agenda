import { PlaceholderScreen } from "@/ui/screens/placeholder";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <PlaceholderScreen title="Tareas" icon="checklist" body="Las tareas, listas e Inbox llegan en la fase 4." />;
}
