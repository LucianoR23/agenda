import { AppShell } from "@/ui/shell";

/** Every app screen runs inside the client shell (auth gate, offline cache, sync, navigation). */
/** Rendered only after the client gate (auth + offline cache): nothing to validate for instant navigation. */
export const instant = false;

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
