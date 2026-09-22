import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { RuntimeHost, RuntimeServices, RuntimeSession } from "@bcr/core";
import { ApplicationStatusProvider } from "./application-status";

const RuntimeContext = createContext<RuntimeServices | null>(null);
const ActivityContext = createContext(true);
export function RuntimeActivity(props: { active: boolean; children: ReactNode }) {
  return createElement(ActivityContext.Provider, { value: props.active }, props.children);
}
export function useRuntimeActivity(): boolean {
  return useContext(ActivityContext);
}

export function RuntimeProvider(props: { services: RuntimeServices; children: ReactNode }) {
  return createElement(
    RuntimeContext.Provider,
    { value: props.services },
    createElement(ApplicationStatusProvider, { children: props.children }),
  );
}

export function useRuntime(): RuntimeServices {
  const services = useContext(RuntimeContext);
  if (services === null) {
    throw new Error("useRuntime must be used within <RuntimeProvider>");
  }
  return services;
}

/**
 * Optional runtime access for domain apps that can also run in an isolated
 * preview.  The Studio Shell always supplies the shared runtime; standalone
 * previews can keep their local fallback without throwing during render.
 */
export function useOptionalRuntime(): RuntimeServices | null {
  return useContext(RuntimeContext);
}

/** Own a session; inherit the host budget and search from an enclosing workspace. */
export function useRuntimeSession(
  create: (host?: RuntimeHost) => Promise<RuntimeSession>,
  initialize?: (services: RuntimeServices) => Promise<void>,
): { services: RuntimeServices | null; error: string | null } {
  const parent = useOptionalRuntime();
  const host = parent?.host;
  const search = parent?.search;
  const [result, setResult] = useState<{ services: RuntimeServices | null; error: string | null }>({
    services: null,
    error: null,
  });
  const lifetime = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    let cancelled = false;
    let stop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      stop = resolve;
    });
    const previous = lifetime.current;
    setResult({ services: null, error: null });
    lifetime.current = (async () => {
      await previous;
      if (cancelled) return;
      let session: RuntimeSession | undefined;
      try {
        session = await create(host);
        if (cancelled) return;
        const services = { ...session, search: search ?? session.search };
        await initialize?.(services);
        if (!cancelled) {
          setResult({ services, error: null });
          await stopped;
        }
      } catch (error) {
        if (!cancelled)
          setResult({
            services: null,
            error: error instanceof Error ? error.message : String(error),
          });
      } finally {
        await session
          ?.dispose()
          .catch((error: unknown) => console.error("Runtime cleanup failed", error));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [create, initialize, host, search]);
  return result;
}
