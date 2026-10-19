import { HistoryScreen } from "@/ui/screens/history";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <HistoryScreen />;
}
