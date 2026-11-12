import { PlaceholderScreen } from "@/ui/screens/placeholder";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <PlaceholderScreen title="Métricas" icon="insights" body="Las métricas, hábitos y sueño llegan en la fase 7." />;
}
