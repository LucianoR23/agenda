import { TodayScreen } from "@/ui/screens/today/today";

/** Rendered only after the client gate (auth + offline cache): nothing to validate for instant navigation. */
export const instant = false;

export default function TodayPage() {
  return <TodayScreen />;
}
