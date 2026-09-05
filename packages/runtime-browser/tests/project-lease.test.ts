import { describe, expect, it } from "vitest";
import { acquireProjectLease } from "../src/project-lease";

describe("project writer lease", () => {
  it("rejects a second writer and allows reopening after disposal", async () => {
    const held = new Set<string>();
    const locks = {
      request: async (
        name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<void>,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({ name });
        } finally {
          held.delete(name);
        }
      },
    } as unknown as Pick<LockManager, "request">;
    const release = await acquireProjectLease(locks, "same-project");
    await expect(acquireProjectLease(locks, "same-project")).rejects.toThrow("already open");
    const other = await acquireProjectLease(locks, "other-project");
    await other();
    await release();
    await release();
    const reopened = await acquireProjectLease(locks, "same-project");
    await reopened();
    expect(held.size).toBe(0);
  });
});
