import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://bcr.example";
const assets = Array.from({ length: 16 }, (_, index) => `/assets/chunk-${index}.js`);

function installer(
  path: string,
  download: (url: string, signal: AbortSignal) => Promise<Response>,
) {
  const entries = [
    "index.html",
    "src/reader-main.tsx",
    "src/studio-main.tsx",
    "notes/knowledge/index.html",
    "pwa/workspace/index.html",
  ];
  const manifest = Object.fromEntries(entries.map((key) => [key, { assets }]));
  const stored = new Map<string, Map<string, string>>([["previous-release", new Map()]]);
  const events: string[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) =>
    url === "/build-manifest.json"
      ? Response.json(manifest)
      : download(url, init.signal as AbortSignal),
  );
  const source = readFileSync(new URL(path, import.meta.url), "utf8").replace(
    /^import .*;\n/gmu,
    "",
  );
  const worker = runInNewContext(`${source}\n;({stageShell});`, {
    __BCR_READER_BUILD_ID__: "123",
    __BCR_NOTES_BUILD_ID__: "123",
    __BCR_PWA_APPS__: [
      {
        key: "workspace",
        scope: "/pwa/workspace/",
        startUrl: "/pwa/workspace/",
        manifestUrl: "/pwa/workspace/manifest.webmanifest",
        icon: "workspace",
        entry: "src/studio-main.tsx",
      },
    ],
    location: { href: `${origin}/pwa/sw.js?app=workspace` },
    registration: { scope: `${origin}/pwa/workspace/` },
    addEventListener: vi.fn(),
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    fetch,
    Request: class extends Request {
      constructor(url: string) {
        super(new URL(url, origin));
      }
    },
    caches: {
      async delete(name: string) {
        events.push(`delete:${name}`);
        return stored.delete(name);
      },
      async open(name: string) {
        const items = stored.get(name) ?? new Map<string, string>();
        stored.set(name, items);
        return {
          async put(request: Request, response: Response) {
            const body = await response.text();
            events.push(`put:${name}`);
            items.set(new URL(request.url).pathname, body);
          },
        };
      },
    },
  }) as { stageShell: () => Promise<void> };
  return { ...worker, fetch, stored, events };
}

afterEach(() => vi.useRealTimers());

describe.each([
  "../src/service-worker.js",
  "../src/knowledge/service-worker.js",
  "../src/pwa/service-worker.js",
])("PWA installation: %s", (path) => {
  it("allows responses after 12 seconds without flooding the network", async () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    let aborted = 0;
    const setup = installer(
      path,
      (_url, signal) =>
        new Promise((resolve, reject) => {
          active++;
          peak = Math.max(peak, active);
          const timer = setTimeout(() => {
            active--;
            resolve(new Response("asset"));
          }, 13_000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            aborted++;
            active--;
            reject(signal.reason);
          });
        }),
    );
    const complete = vi.fn();
    const staging = setup.stageShell().then(complete);
    await vi.advanceTimersByTimeAsync(12_500);
    expect(aborted).toBe(0);
    expect(complete).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    await staging;
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(6);
    expect(aborted).toBe(0);
    expect([...setup.stored.values()].some((cache) => assets.every((url) => cache.has(url)))).toBe(
      true,
    );
  });

  it("retries temporary network and server failures before publishing the shell", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const setup = installer(path, async (url) => {
      if (url === assets[0]) {
        attempts++;
        if (attempts === 1) throw new TypeError("Failed to fetch");
        if (attempts === 2) return new Response(null, { status: 503 });
      }
      return new Response("asset");
    });
    const staging = setup.stageShell();
    await vi.runAllTimersAsync();
    await staging;
    expect(attempts).toBe(3);
    expect(setup.stored.size).toBe(2);
  });

  it("bounds stalled response bodies and cleans up only after pending writes settle", async () => {
    vi.useFakeTimers();
    let aborted = 0;
    const setup = installer(path, async (url, signal) => {
      if (url !== assets[0]) return new Response("asset");
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            signal.addEventListener("abort", () => {
              aborted++;
              controller.error(signal.reason);
            });
          },
        }),
      );
    });
    const result = setup.stageShell().catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(String(await result)).toContain(assets[0]);
    expect(aborted).toBe(3);
    expect([...setup.stored.keys()]).toEqual(["previous-release"]);
    expect(setup.events.at(-1)).toMatch(/^delete:/u);
  });

  it.each([404, 200])(
    "rejects a missing asset or HTML fallback (%s) without retrying",
    async (status) => {
      vi.useFakeTimers();
      let attempts = 0;
      const setup = installer(path, async (url) => {
        if (url === assets[0]) {
          attempts++;
          return new Response("<html>fallback</html>", {
            status,
            headers: { "Content-Type": "text/html" },
          });
        }
        return new Response("asset");
      });
      const result = setup.stageShell().catch((error: unknown) => error);
      await vi.runAllTimersAsync();
      expect(String(await result)).toContain(assets[0]);
      expect(attempts).toBe(1);
      expect([...setup.stored.keys()]).toEqual(["previous-release"]);
      expect(setup.events.at(-1)).toMatch(/^delete:/u);
    },
  );
});
