/** Hold a browser-wide exclusive lease until the session has flushed and closed. */
export async function acquireProjectLease(
  locks: Pick<LockManager, "request">,
  namespace: string,
): Promise<() => Promise<void>> {
  let release!: () => void;
  const lifetime = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  let failed!: (reason: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    acquired = resolve;
    failed = reject;
  });
  const held = locks.request(
    `bcr:project:${namespace}`,
    { mode: "exclusive", ifAvailable: true },
    async (lock) => {
      if (lock === null)
        throw new Error(
          `Project "${namespace}" is already open in another session. Close it before reopening.`,
        );
      acquired();
      await lifetime;
    },
  );
  void held.catch(failed);
  await ready;
  return async () => {
    release();
    await held;
  };
}
