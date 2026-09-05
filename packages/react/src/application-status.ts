import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type RunningApps = Readonly<Record<string, number>>;
const empty: RunningApps = {};

function createStatusStore() {
  let snapshot = empty;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report: (app: string, count: number | undefined) => {
      if (snapshot[app] === count) return;
      const next = { ...snapshot };
      if (count === undefined) delete next[app];
      else next[app] = count;
      snapshot = next;
      for (const listener of listeners) listener();
    },
  };
}
const StatusContext = createContext<ReturnType<typeof createStatusStore> | null>(null);

/** Nested runtime providers contribute to the enclosing workspace's UI projection. */
export function ApplicationStatusProvider(props: { children: ReactNode }) {
  const parent = useContext(StatusContext);
  const [local] = useState(createStatusStore);
  return createElement(StatusContext.Provider, { value: parent ?? local }, props.children);
}

export function usePublishRunningCount(app: string, count: number): void {
  const store = useContext(StatusContext);
  useEffect(() => {
    store?.report(app, count);
  }, [store, app, count]);
  useEffect(
    () => () => {
      store?.report(app, undefined);
    },
    [store, app],
  );
}

const subscribeEmpty = () => () => undefined;
const getEmpty = () => empty;
export function useRunningApps(): RunningApps {
  const store = useContext(StatusContext);
  return useSyncExternalStore(
    store?.subscribe ?? subscribeEmpty,
    store?.getSnapshot ?? getEmpty,
    getEmpty,
  );
}
