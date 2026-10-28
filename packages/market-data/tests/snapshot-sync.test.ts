import { mkdtemp, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseSnapshotSyncArgs,
  runSnapshotSync,
  writeSnapshotAtomically,
  type SnapshotSyncOptions,
  type SyncSnapshot,
} from "../../../scripts/lib/snapshot-sync";

interface Fixture extends SyncSnapshot {
  source: string;
  fetchedAt: string;
  series: { id: string; observations: { period: string; value: number | null }[] }[];
}
const snapshot = (source = "official", value: number | null = 0): Fixture => ({
  source,
  fetchedAt: "2026-10-25T12:00:00Z",
  series: [{ id: source, observations: [{ period: "2026-09", value }] }],
});
function parse(value: unknown): Fixture {
  if (!value || typeof value !== "object" || !("series" in value) || !Array.isArray(value.series))
    throw new Error("Invalid fixture");
  return value as Fixture;
}
const merge = (...items: Fixture[]): Fixture => ({
  source: "merged",
  fetchedAt: items.at(-1)?.fetchedAt ?? "",
  series: items.flatMap((item) => item.series),
});
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bcr-snapshot-sync-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
function options(
  providers: SnapshotSyncOptions<Fixture>["providers"],
  args: string[] = [],
): SnapshotSyncOptions<Fixture> {
  return {
    domain: "fixture",
    providers,
    directory,
    parse,
    merge,
    args,
    logger: { log: vi.fn(), error: vi.fn() },
  };
}
const target = (name: string) => join(directory, `${name}-snapshot.json`);

describe("registry-derived snapshot CLI", () => {
  it("accepts newly registered source names without changing a regex or usage list", () => {
    const providers = { alpha: async () => snapshot(), "new-source-v2": async () => snapshot() };
    expect(parseSnapshotSyncArgs([], providers, "fixture sync")).toEqual({
      checkOnly: false,
      selected: "all",
    });
    expect(
      parseSnapshotSyncArgs(["--check", "--source=new-source-v2"], providers, "fixture sync"),
    ).toEqual({ checkOnly: true, selected: "new-source-v2" });
    expect(() => parseSnapshotSyncArgs(["--source=other"], providers, "fixture sync")).toThrow(
      "Usage: fixture sync [--check] [--source=all|alpha|new-source-v2]",
    );
    expect(() => parseSnapshotSyncArgs(["--wat"], providers, "fixture sync")).toThrow(/Usage/u);
    expect(() =>
      parseSnapshotSyncArgs(["--source=constructor"], providers, "fixture sync"),
    ).toThrow(/Usage/u);
  });

  it("rejects invalid arguments before reading or fetching any resource", async () => {
    const fetch = vi.fn(async () => snapshot());
    const read = vi.fn(async () => "");
    await expect(
      runSnapshotSync({ ...options({ alpha: fetch }, ["--source=missing"]), io: { read } }),
    ).rejects.toThrow(/all\|alpha/u);
    expect(fetch).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(() => parseSnapshotSyncArgs([], {}, "fixture")).toThrow(/registry/u);
  });
});

describe("read-only checks and independent source maintenance", () => {
  it("checks the selected local resource, preserving exact bytes and never invoking providers or mutations", async () => {
    const existing = `${JSON.stringify(snapshot("existing", -0.123456789012345))}\n`;
    await writeFile(target("new-source-v2"), existing);
    const alpha = vi.fn(async () => snapshot("alpha"));
    const selected = vi.fn(async () => snapshot("network"));
    const write = vi.fn(async () => {}),
      move = vi.fn(async () => {}),
      remove = vi.fn(async () => {});
    const result = await runSnapshotSync({
      ...options({ alpha, "new-source-v2": selected }, ["--check", "--source=new-source-v2"]),
      io: { write, rename: move, remove },
    });
    expect(result.exitCode).toBe(0);
    expect(result.checkOnly).toBe(true);
    expect(result.sources).toEqual(["new-source-v2"]);
    expect(result.merged.series[0]?.observations[0]?.value).toBe(-0.123456789012345);
    expect(alpha).not.toHaveBeenCalled();
    expect(selected).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await readFile(target("new-source-v2"), "utf8")).toBe(existing);
    expect(await readdir(directory)).toEqual(["new-source-v2-snapshot.json"]);
  });

  it("reports malformed local resources with a nonzero result and preserves all files without fetching", async () => {
    await writeFile(target("bad"), "{broken json");
    await writeFile(target("good"), JSON.stringify(snapshot("good", 0)));
    const bad = vi.fn(async () => snapshot()),
      good = vi.fn(async () => snapshot());
    const result = await runSnapshotSync(options({ bad, good }, ["--check"]));
    expect(result.exitCode).toBe(1);
    expect(result.results.map((item) => item.status)).toEqual(["rejected", "fulfilled"]);
    expect(result.merged.series.map((item) => item.id)).toEqual(["good"]);
    expect(bad).not.toHaveBeenCalled();
    expect(good).not.toHaveBeenCalled();
    expect(await readFile(target("bad"), "utf8")).toBe("{broken json");
    expect(await readdir(directory)).toEqual(["bad-snapshot.json", "good-snapshot.json"]);
  });

  it("settles every provider, updates successful resources, keeps failed resources and returns nonzero", async () => {
    const old = `${JSON.stringify(snapshot("old", 1))}\n`;
    await writeFile(target("failed"), old);
    await writeFile(target("successful"), old);
    let finish: ((value: Fixture) => void) | undefined;
    const successful = vi.fn(
      () =>
        new Promise<Fixture>((resolve) => {
          finish = resolve;
        }),
    );
    const failed = vi.fn(async () => {
      throw new Error("Source unavailable");
    });
    const run = runSnapshotSync(options({ failed, successful }));
    await Promise.resolve();
    expect(successful).toHaveBeenCalledOnce();
    finish!(snapshot("updated", 0.1234567890123456));
    const result = await run;
    expect(result.exitCode).toBe(1);
    expect(result.results.map((item) => item.status)).toEqual(["rejected", "fulfilled"]);
    expect(await readFile(target("failed"), "utf8")).toBe(old);
    const updated = JSON.parse(await readFile(target("successful"), "utf8")) as Fixture;
    expect(updated.series[0]?.observations[0]?.value).toBe(0.1234567890123456);
    expect(result.merged.series.map((item) => item.id)).toEqual(["updated"]);
    expect((await readdir(directory)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("accepts genuine zeros but refuses empty, all-null or non-finite source series before writing", async () => {
    for (const invalid of [
      { ...snapshot(), series: [] },
      snapshot("missing", null),
      { ...snapshot(), series: [{ id: "empty", observations: [] }] },
      snapshot("invalid", Number.NaN),
    ]) {
      const old = JSON.stringify(snapshot("old", -1));
      await writeFile(target("bad"), old);
      const result = await runSnapshotSync(
        options({ bad: async () => invalid, zero: async () => snapshot("zero", 0) }),
      );
      expect(result.exitCode).toBe(1);
      expect(await readFile(target("bad"), "utf8")).toBe(old);
      expect(JSON.parse(await readFile(target("zero"), "utf8"))).toEqual(snapshot("zero", 0));
    }
  });

  it("runs only the selected provider and retains the domain-specific merge callback", async () => {
    const alpha = vi.fn(async () => snapshot("alpha")),
      beta = vi.fn(async () => snapshot("beta"));
    const combine = vi.fn(merge);
    const result = await runSnapshotSync({
      ...options({ alpha, beta }, ["--source=beta"]),
      merge: combine,
    });
    expect(alpha).not.toHaveBeenCalled();
    expect(beta).toHaveBeenCalledOnce();
    expect(result.sources).toEqual(["beta"]);
    expect(combine).toHaveBeenCalledWith(snapshot("beta"));
    expect(await readdir(directory)).toEqual(["beta-snapshot.json"]);
  });
});

describe("same-directory atomic replacement", () => {
  it("uses distinct temporary paths and preserves source precision during successful replacement", async () => {
    const file = target("official"),
      names: string[] = [];
    const io = {
      rename: async (temporary: string, destination: string) => {
        expect(dirname(temporary)).toBe(dirname(destination));
        names.push(temporary);
        await rename(temporary, destination);
      },
    };
    await writeSnapshotAtomically(file, snapshot("one", 123456789.12345679), io);
    await writeSnapshotAtomically(file, snapshot("two", -0.00000000001234567), io);
    expect(new Set(names).size).toBe(2);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(snapshot("two", -0.00000000001234567));
    expect((await readdir(directory)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("cleans a partially written temporary file and preserves the existing target on write failure", async () => {
    const file = target("official");
    await writeFile(file, "old resource\n");
    await expect(
      writeSnapshotAtomically(file, snapshot(), {
        write: async (temporary) => {
          await writeFile(temporary, "partially written");
          throw new Error("Disk full");
        },
      }),
    ).rejects.toThrow("Disk full");
    expect(await readFile(file, "utf8")).toBe("old resource\n");
    expect(await readdir(directory)).toEqual(["official-snapshot.json"]);
  });

  it("cleans the completed temporary file on rename failure and reports the source failure without changing its target", async () => {
    const file = target("official");
    await writeFile(file, "old resource\n");
    const result = await runSnapshotSync({
      ...options({ official: async () => snapshot() }),
      io: {
        rename: async () => {
          throw new Error("Rename denied");
        },
      },
    });
    expect(result.exitCode).toBe(1);
    expect(result.results[0]?.status).toBe("rejected");
    expect(await readFile(file, "utf8")).toBe("old resource\n");
    expect(await readdir(directory)).toEqual(["official-snapshot.json"]);
  });
});
