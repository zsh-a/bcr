import { expect, it } from "vitest";
import { createRenderQueue } from "../src/renderQueue";

it("bounds render work and removes cancelled waiters", async () => {
  const queue = createRenderQueue(1);
  const controller = new AbortController();
  let release!: () => void;
  const first = queue(
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  let ran = false;
  const second = queue(controller.signal, async () => {
    ran = true;
  });
  const rejection = expect(second).rejects.toThrow();
  controller.abort();
  await rejection;
  expect(ran).toBe(false);
  release();
  await first;
  expect(await queue(new AbortController().signal, async () => "ready")).toBe("ready");
});

it("releases a slot when rendering fails", async () => {
  const queue = createRenderQueue(1);
  await expect(
    queue(new AbortController().signal, async () => {
      throw new Error("render");
    }),
  ).rejects.toThrow("render");
  expect(await queue(new AbortController().signal, async () => 42)).toBe(42);
});
