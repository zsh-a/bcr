import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export interface NavigationSnapshot {
  readonly pathname: string;
  readonly search: string;
  /** Changes even when the same citation/URL is opened again. */
  readonly revision: number;
}

export interface NavigationService {
  readonly getSnapshot: () => NavigationSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly navigate: (url: string, replace?: boolean) => void;
}

const empty: NavigationSnapshot = { pathname: "/", search: "", revision: 0 };
let browserSnapshot = empty;
const listeners = new Set<() => void>();
function readBrowser(): NavigationSnapshot {
  if (typeof window === "undefined") return empty;
  if (
    browserSnapshot.pathname !== window.location.pathname ||
    browserSnapshot.search !== window.location.search
  )
    browserSnapshot = {
      pathname: window.location.pathname,
      search: window.location.search,
      revision: browserSnapshot.revision + 1,
    };
  return browserSnapshot;
}
function publishBrowser() {
  readBrowser();
  browserSnapshot = { ...browserSnapshot, revision: browserSnapshot.revision + 1 };
  for (const listener of listeners) listener();
}
const browserNavigation: NavigationService = {
  getSnapshot: readBrowser,
  subscribe(listener) {
    if (listeners.size === 0) window.addEventListener("popstate", publishBrowser);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) window.removeEventListener("popstate", publishBrowser);
    };
  },
  navigate(url, replace = false) {
    if (replace) window.history.replaceState({}, "", url);
    else window.history.pushState({}, "", url);
    publishBrowser();
  },
};

const NavigationContext = createContext<NavigationService>(browserNavigation);
export function NavigationProvider({
  service,
  children,
}: {
  service: NavigationService;
  children: ReactNode;
}) {
  return createElement(NavigationContext.Provider, { value: service }, children);
}
export function useNavigation(): NavigationService {
  return useContext(NavigationContext);
}
export function useLocationSnapshot(): NavigationSnapshot {
  const service = useNavigation();
  return useSyncExternalStore(service.subscribe, service.getSnapshot, () => empty);
}
export function useLocationSearch(): string {
  return useLocationSnapshot().search;
}
