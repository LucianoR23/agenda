"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { get } from "@/client/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?task=<id>` (and friends) from the `url` the API hands Sunday: fetch the item, open its sheet, drop the
 * parameter so a reload or back doesn't reopen it. Unknown ids just land on the screen.
 */
export function useDeepLink<T>(param: string, path: (id: string) => string, open: (item: T) => void) {
  const id = useSearchParams().get(param);
  const router = useRouter();
  const pathname = usePathname();
  // latest callbacks without re-running the effect (they're new closures every render)
  const latest = useRef({ path, open });
  useEffect(() => {
    latest.current = { path, open };
  });

  useEffect(() => {
    if (!id) return;
    if (!UUID.test(id)) {
      router.replace(pathname, { scroll: false });
      return;
    }
    let live = true;
    get<T>(latest.current.path(id))
      .then((item) => {
        if (live) latest.current.open(item);
      })
      .catch(() => {})
      .finally(() => {
        if (live) router.replace(pathname, { scroll: false });
      });
    return () => {
      live = false;
    };
  }, [id, router, pathname]);
}
