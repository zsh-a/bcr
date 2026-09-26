import { NavigationProvider, type NavigationService } from "@bcr/react";
import { useMemo, type ReactNode } from "react";
import { pwaAtPath } from "./apps";

/** Reader's lightweight entry uses browser history instead of the Studio router. */
export function ReaderNavigation({ children }: { children: ReactNode }) {
  const app = pwaAtPath(location.pathname);
  const service = useMemo<NavigationService>(() => {
    let revision = 0;
    let snapshot = { pathname: "/reader", search: location.search, revision };
    const listeners = new Set<() => void>();
    const read = () => {
      if (snapshot.search !== location.search || snapshot.revision !== revision)
        snapshot = { pathname: "/reader", search: location.search, revision };
      return snapshot;
    };
    const publish = () => {
      revision++;
      for (const listener of listeners) listener();
    };
    return {
      getSnapshot: read,
      subscribe(listener) {
        if (!listeners.size) window.addEventListener("popstate", publish);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
          if (!listeners.size) window.removeEventListener("popstate", publish);
        };
      },
      navigate(href, replace = false) {
        const url = new URL(href, location.origin);
        if (
          url.origin === location.origin &&
          ["/reader", "/reader/", app?.startUrl].includes(url.pathname)
        ) {
          url.pathname = app?.startUrl ?? "/reader";
          if (replace) history.replaceState({}, "", url);
          else history.pushState({}, "", url);
          publish();
        } else if (replace) location.replace(url);
        else location.assign(url);
      },
    };
  }, [app]);
  return <NavigationProvider service={service}>{children}</NavigationProvider>;
}
