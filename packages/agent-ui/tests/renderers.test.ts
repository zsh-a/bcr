import { describe, expect, it, vi } from "vitest";
import { createResultRegistry, type ResultRenderer } from "../src/renderers";

const renderer: ResultRenderer = {
  kind: "test",
  version: 1,
  accepts: () => true,
  component: () => null,
};
describe("result renderer registry", () => {
  it("registers and releases renderers without changing unrelated entries", () => {
    const registry = createResultRegistry([renderer]);
    const listener = vi.fn();
    const stop = registry.subscribe(listener);
    const initial = registry.getSnapshot();
    expect(registry.getSnapshot()).toBe(initial);
    const remove = registry.register({ ...renderer, version: 2 });
    expect(registry.getSnapshot()).toHaveLength(2);
    remove();
    remove();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(registry.getSnapshot()).toEqual([renderer]);
    stop();
    registry.register({ ...renderer, version: 3 });
    expect(listener).toHaveBeenCalledTimes(2);
  });
  it("rejects duplicate keys and invalid versions", () => {
    expect(() => createResultRegistry([renderer, renderer])).toThrow("duplicate");
    for (const version of [0, -1, 1.5, NaN])
      expect(() => createResultRegistry([{ ...renderer, version }])).toThrow();
  });
  it("isolates registries across hosts", () => {
    const first = createResultRegistry([renderer]);
    expect(createResultRegistry().getSnapshot()).toEqual([]);
    expect(first.getSnapshot()).toHaveLength(1);
  });
});
