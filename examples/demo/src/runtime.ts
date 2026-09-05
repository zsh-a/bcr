import type { RuntimeSession } from "@bcr/core";
import { createBrowserRuntime } from "@bcr/runtime-browser";
import { workerExecutor, WorkerPool } from "@bcr/runtime-worker";

export async function createRuntimeServices(): Promise<RuntimeSession> {
  return createBrowserRuntime({
    namespace: "demo",
    execution: (artifacts) => {
      const pool = new WorkerPool(
        1,
        () =>
          new Worker(new URL("./workers/compute.worker.ts", import.meta.url), { type: "module" }),
      );
      return {
        executors: [
          workerExecutor(pool, "wasm", "demo-kernels-1", artifacts, ["hash.blake3", "audio.rms"]),
        ],
        dispose: () => pool.shutdown(),
      };
    },
  });
}
