import { describe, expect, it, vi } from "vitest";
import { createUpdateCoordinator } from "../src/updateCoordinator";

describe("application update boundary", () => {
  it("saves all domains before activating", async () => {
    const update = createUpdateCoordinator();
    const steps: string[] = [];
    for (const name of ["reader", "notes", "agent"])
      update.register({
        blocked: () => null,
        save: async () => {
          steps.push(name);
        },
      });
    await update.apply(() => {
      steps.push("activate");
    });
    expect(steps).toEqual(["reader", "notes", "agent", "activate"]);
  });
  it("blocks before saving and rechecks activity after saving", async () => {
    const update = createUpdateCoordinator();
    let busy = true;
    const save = vi.fn(async () => {
      busy = true;
    });
    const activate = vi.fn();
    update.register({ blocked: () => (busy ? "busy" : null), save });
    await expect(update.apply(activate)).rejects.toThrow("busy");
    expect(save).not.toHaveBeenCalled();
    busy = false;
    await expect(update.apply(activate)).rejects.toThrow("busy");
    expect(save).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });
  it("retains the current release after save failure and allows retry", async () => {
    const update = createUpdateCoordinator();
    const save = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue(undefined);
    const activate = vi.fn();
    update.register({ blocked: () => null, save });
    await expect(update.apply(activate)).rejects.toThrow("disk full");
    expect(activate).not.toHaveBeenCalled();
    await update.apply(activate);
    expect(activate).toHaveBeenCalledOnce();
  });
  it("joins duplicate requests and removes unmounted participants", async () => {
    const update = createUpdateCoordinator();
    const remove = update.register({ blocked: () => "unmounted", save: async () => {} });
    remove();
    const activate = vi.fn();
    const first = update.apply(activate);
    expect(update.apply(activate)).toBe(first);
    await first;
    expect(activate).toHaveBeenCalledOnce();
  });
});
