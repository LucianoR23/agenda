import { TasksScreen } from "@/ui/screens/tasks";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <TasksScreen />;
}
