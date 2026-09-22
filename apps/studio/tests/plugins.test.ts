import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "@bcr/shell-contract";
import { activatePlugins } from "../src/shell/plugins";

describe("plugin lifecycle", () => {
  it("rolls back partial activation in reverse order", () => {
    const events: string[] = [];
    const context = { reportError: vi.fn() } as unknown as PluginContext;
    expect(() =>
      activatePlugins(
        [
          {
            id: "first",
            activate: () => () => {
              events.push("first");
            },
          },
          {
            id: "second",
            activate: () => () => {
              events.push("second");
            },
          },
          {
            id: "fail",
            activate: () => {
              throw new Error("failed");
            },
          },
        ],
        context,
      ),
    ).toThrow("failed");
    expect(events).toEqual(["second", "first"]);
  });
  it("validates duplicates before activation and disposes once", () => {
    const activate = vi.fn(() => vi.fn());
    const plugin = { id: "test", activate };
    const context = { reportError: vi.fn() } as unknown as PluginContext;
    expect(() => activatePlugins([plugin, plugin], context)).toThrow(/Duplicate/);
    expect(activate).not.toHaveBeenCalled();
    const dispose = activatePlugins([plugin], context);
    dispose();
    dispose();
    expect(activate.mock.results[0]?.value).toHaveBeenCalledTimes(1);
  });
});
