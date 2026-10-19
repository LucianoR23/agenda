import { SecurityScreen } from "@/ui/screens/security";

/** Rendered only after the client gate (auth + offline cache). */
export const instant = false;

export default function Page() {
  return <SecurityScreen />;
}
