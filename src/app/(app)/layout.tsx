import { AppShell } from "@/ui/shell";

/** Every app screen runs inside the client shell (auth gate, offline cache, sync, navigation). */

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
