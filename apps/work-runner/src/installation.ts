import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { hash, json } from "./projects";
import { TOOLS, engineLock, hashFile, walk } from "@bcr/work-engine";

export const installation = resolve(import.meta.dir, "..");
export const workerEntry = join(
  import.meta.dir,
  import.meta.file.endsWith(".ts") ? "worker.ts" : "worker.js",
);
export const cliEntry = join(
  import.meta.dir,
  import.meta.file.endsWith(".ts") ? "cli.ts" : "cli.js",
);
const require = createRequire(join(installation, "package.json"));
export function dependencyDirectory(name: string) {
  let directory = dirname(require.resolve(name));
  for (;;) {
    const manifest = join(directory, "package.json");
    if (existsSync(manifest) && (json(manifest) as { name?: string }).name === name)
      return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`缺少运行依赖：${name}`);
    directory = parent;
  }
}
type Release = { version: string; build: string; dependencies: Record<string, string> };
export function release(): Release {
  const path = join(installation, "release.json");
  if (existsSync(path)) return json(path) as Release;
  // Development only. Published builds contain their own content identity and lockfile.
  const manifest = json(join(installation, "package.json")) as {
    version: string;
    dependencies: Record<string, string>;
  };
  const dependencies = Object.fromEntries(
    Object.keys(manifest.dependencies)
      .filter((n) => !n.startsWith("@bcr/"))
      .map((n) => [
        n,
        (json(join(installation, "node_modules", n, "package.json")) as { version: string })
          .version,
      ]),
  );
  return {
    version: `${manifest.version}-dev`,
    dependencies,
    build: hash(
      JSON.stringify({
        sources: readdirSync(import.meta.dir)
          .filter((f) => f.endsWith(".ts"))
          .sort()
          .map((f) => hash(readFileSync(join(import.meta.dir, f)))),
        core: readdirSync(dirname(require.resolve("@bcr/work-core")))
          .filter((f) => f.endsWith(".ts"))
          .sort()
          .map((f) => hash(readFileSync(join(dirname(require.resolve("@bcr/work-core")), f)))),
        dependencies,
        workEngine: walk(join(TOOLS, "src")).map((file) => [
          file.slice(TOOLS.length),
          hashFile(file),
        ]),
        engineLock: hashFile(engineLock()),
      }),
    ),
  };
}
export function engineIdentity() {
  return hash(
    JSON.stringify({
      release: release(),
      bun: Bun.version,
      platform: process.platform,
      arch: process.arch,
      browser: process.env.BCR_RUNNER_BROWSER
        ? hash(readFileSync(process.env.BCR_RUNNER_BROWSER))
        : "remotion-managed",
    }),
  );
}
