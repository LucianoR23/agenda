import { HabitsSettingsScreen } from "@/ui/screens/habits-settings";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <HabitsSettingsScreen />;
}
