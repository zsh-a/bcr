import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface SyncSnapshot {
  fetchedAt: string;
  series: readonly { observations: readonly { value: number | null }[] }[];
}
export type SnapshotProviders<T extends SyncSnapshot> = Readonly<Record<string, () => Promise<T>>>;
export interface SnapshotSyncArgs {
  checkOnly: boolean;
  selected: string;
}
export interface SnapshotSyncIO {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  rename: (temporary: string, target: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
}
const nodeIO: SnapshotSyncIO = {
  read: (path) => readFile(path, "utf8"),
  write: (path, content) => writeFile(path, content, { encoding: "utf8", flag: "wx" }),
  rename,
  remove: (path) => rm(path, { force: true }),
};
export interface SnapshotSyncOptions<T extends SyncSnapshot> {
  domain: string;
  providers: SnapshotProviders<T>;
  directory: URL | string;
  parse: (value: unknown) => T;
  merge: (...snapshots: T[]) => T;
  args?: readonly string[];
  command?: string;
  logger?: Pick<Console, "log" | "error">;
  /** Override only for isolated filesystem failure tests. */
  io?: Partial<SnapshotSyncIO>;
}
export interface SnapshotSyncResult<T extends SyncSnapshot> {
  checkOnly: boolean;
  sources: string[];
  results: PromiseSettledResult<T>[];
  merged: T;
  exitCode: 0 | 1;
}

/** Registered names are the single source of truth for selection and usage text. */
export function parseSnapshotSyncArgs<T extends SyncSnapshot>(
  args: readonly string[],
  providers: SnapshotProviders<T>,
  command: string,
): SnapshotSyncArgs {
  const names = Object.keys(providers);
  if (!names.length || Object.hasOwn(providers, "all"))
    throw new Error("Snapshot registry must contain sources and reserve 'all' for selection");
  const usage = `Usage: ${command} [--check] [--source=${["all", ...names].join("|")}]`;
  let selected: string | undefined;
  for (const arg of args) {
    if (arg === "--check") continue;
    if (!arg.startsWith("--source=")) throw new Error(usage);
    const source = arg.slice("--source=".length);
    if (source !== "all" && !Object.hasOwn(providers, source)) throw new Error(usage);
    selected ??= source;
  }
  return { checkOnly: args.includes("--check"), selected: selected ?? "all" };
}

/** Write beside the destination, then rename once. Failed writes leave the old destination intact. */
export async function writeSnapshotAtomically(
  target: string,
  snapshot: SyncSnapshot,
  overrides: Partial<SnapshotSyncIO> = {},
): Promise<void> {
  const io = { ...nodeIO, ...overrides };
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let renamed = false;
  try {
    await io.write(temporary, `${JSON.stringify(snapshot)}\n`);
    await io.rename(temporary, target);
    renamed = true;
  } finally {
    // Successful rename consumes the temporary path; only failed attempts can leave a file behind.
    if (!renamed) await io.remove(temporary);
  }
}
function assertContent(snapshot: SyncSnapshot, name: string): void {
  if (
    !snapshot.series.length ||
    snapshot.series.some((series) => !series.observations.some((point) => point.value !== null))
  )
    throw new Error(`${name}: Empty series rejected; keep previous resource`);
  if (
    snapshot.series.some((series) =>
      series.observations.some((point) => point.value !== null && !Number.isFinite(point.value)),
    )
  )
    throw new Error(`${name}: Non-finite observation rejected; keep previous resource`);
}

/** Sources settle independently: a failed source preserves its old file while others may succeed. */
export async function runSnapshotSync<T extends SyncSnapshot>(
  options: SnapshotSyncOptions<T>,
): Promise<SnapshotSyncResult<T>> {
  const command = options.command ?? `bun run data:${options.domain}:sync`;
  const { checkOnly, selected } = parseSnapshotSyncArgs(
    options.args ?? process.argv.slice(2),
    options.providers,
    command,
  );
  const sources = Object.entries(options.providers).filter(
    ([name]) => selected === "all" || selected === name,
  );
  const logger = options.logger ?? console,
    io = { ...nodeIO, ...options.io };
  const directory =
    options.directory instanceof URL ? fileURLToPath(options.directory) : options.directory;
  const results = await Promise.allSettled(
    sources.map(async ([name, fetchSnapshot]) => {
      const target = join(directory, `${name}-snapshot.json`);
      logger.log(
        `[${options.domain}:${name}] ${checkOnly ? "Validating bundled resource" : "Fetching attributed official observations"}`,
      );
      const snapshot = options.parse(
        checkOnly ? (JSON.parse(await io.read(target)) as unknown) : await fetchSnapshot(),
      );
      assertContent(snapshot, name);
      if (!checkOnly) await writeSnapshotAtomically(target, snapshot, io);
      logger.log(
        `[${options.domain}:${name}] ${snapshot.series.length} series, ${snapshot.series.reduce((sum, series) => sum + series.observations.length, 0)} observations; fetched ${snapshot.fetchedAt}`,
      );
      return snapshot;
    }),
  );
  let exitCode: 0 | 1 = 0;
  for (const [index, result] of results.entries())
    if (result.status === "rejected") {
      logger.error(
        `[${options.domain}:${sources[index]?.[0]}] Failed; existing resource preserved.`,
        result.reason,
      );
      exitCode = 1;
    }
  const merged = options.merge(
    ...results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
  );
  logger.log(
    `[${options.domain}] Resolved ${merged.series.length} complete series. Never splice source bases or seasonal adjustments. ${checkOnly ? "No files changed." : "Rebuild to publish updated resources."}`,
  );
  return { checkOnly, sources: sources.map(([name]) => name), results, merged, exitCode };
}
