import { createBrowserRuntime } from "@bcr/runtime-browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useRuntimeSession } from "../src";

/** Browser-only regression: real Web Locks plus React's repeated effects. */
export async function verifyRuntimeLifecycle(): Promise<void> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let active = 0;
  let maximum = 0;
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const create = async () => {
    await delay(10);
    return createBrowserRuntime({
      namespace: "react-lifecycle-verification",
      execution: () => {
        active += 1;
        maximum = Math.max(maximum, active);
        return {
          executors: [],
          dispose: async () => {
            await delay(20);
            active -= 1;
          },
        };
      },
    });
  };
  const initializeFirst = async () => {
    await delay(10);
  };
  const initializeSecond = async () => {
    await delay(10);
  };
  function Probe(props: { revision: number; initialize: () => Promise<void> }) {
    const { services, error } = useRuntimeSession(create, props.initialize);
    return <span>{error ?? (services === null ? "loading" : `ready-${props.revision}`)}</span>;
  }
  const until = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error(`Runtime lifecycle timed out: ${container.textContent}`);
      await delay(10);
    }
  };
  try {
    root.render(
      <StrictMode>
        <Probe revision={1} initialize={initializeFirst} />
      </StrictMode>,
    );
    await until(() => container.textContent === "ready-1");
    root.render(
      <StrictMode>
        <Probe revision={2} initialize={initializeSecond} />
      </StrictMode>,
    );
    await until(() => container.textContent === "ready-2");
    if (active !== 1 || maximum !== 1)
      throw new Error("Runtime sessions overlapped during remount");
  } finally {
    root.unmount();
    await until(() => active === 0);
    container.remove();
  }
}
