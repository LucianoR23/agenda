import { PageTitle } from "../components/page";
import { EmptyState } from "../components/surfaces";
import type { IconName } from "../icons";

/** Temporary screen while v2 is rebuilt: each phase replaces one of these (see docs/v2/08-roadmap-and-cutover.md). */
export function PlaceholderScreen({ title, icon, body }: { title: string; icon: IconName; body: string }) {
  return (
    <div className="flex flex-col gap-4">
      <PageTitle title={title} />
      <EmptyState icon={icon} title="v2 en construcción" body={body} />
    </div>
  );
}
