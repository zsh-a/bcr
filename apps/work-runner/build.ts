import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { out: { type: "string" }, portable: { type: "boolean" } },
});
const app = import.meta.dir;
const out = resolve(values.out ?? join(app, "../../dist/work-runner"));
const temporary = mkdtempSync(join(tmpdir(), "bcr-runner-release-"));
const source = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
const dependencies = Object.fromEntries(
  Object.keys(source.dependencies)
    .filter((name) => !name.startsWith("@bcr/"))
    .map((name) => [
      name,
      JSON.parse(readFileSync(join(app, "node_modules", name, "package.json"), "utf8")).version,
    ]),
);
async function run(args: string[]) {
  const child = Bun.spawn(args, { cwd: temporary, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`${args[1]} failed: ${stderr}\n${stdout}`);
}
try {
  mkdirSync(out, { recursive: true });
  const manifest = {
    name: source.name,
    version: source.version,
    description: "BCR Works execution service, CLI and MCP adapter",
    type: "module",
    bin: { "bcr-runner": "dist/cli.js" },
    engines: { bun: ">=1.3.14" },
    packageManager: "bun@1.3.14",
    files: [
      "dist",
      "example",
      "release.json",
      "bun.lock",
      "README.md",
      "Dockerfile",
      "compose.yaml",
    ],
    dependencies,
  };
  writeFileSync(join(temporary, "package.json"), JSON.stringify(manifest, null, 2));
  const result = await Bun.build({
    entrypoints: [join(app, "src/cli.ts"), join(app, "src/worker.ts")],
    outdir: join(temporary, "dist"),
    target: "bun",
    format: "esm",
    external: Object.keys(dependencies),
  });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  chmodSync(join(temporary, "dist/cli.js"), 0o755);
  for (const path of ["example", "README.md", "Dockerfile", "compose.yaml"])
    cpSync(join(app, path), join(temporary, path), { recursive: true });
  await run([process.execPath, "install", "--lockfile-only", "--ignore-scripts"]);
  const digest = createHash("sha256");
  for (const path of ["dist/cli.js", "dist/worker.js", "package.json", "bun.lock"])
    digest.update(path).update(readFileSync(join(temporary, path)));
  writeFileSync(
    join(temporary, "release.json"),
    JSON.stringify({ version: source.version, build: digest.digest("hex"), dependencies }, null, 2),
  );
  const packageDirectory = join(out, "package");
  if (existsSync(packageDirectory)) rmSync(packageDirectory, { recursive: true });
  cpSync(temporary, packageDirectory, { recursive: true });
  await run([process.execPath, "pm", "pack", "--destination", out]);
  if (values.portable) {
    await run([
      process.execPath,
      "install",
      "--frozen-lockfile",
      "--ignore-scripts",
      "--production",
    ]);
    mkdirSync(join(temporary, "runtime"));
    cpSync(process.execPath, join(temporary, "runtime/bun"));
    mkdirSync(join(temporary, "bin"));
    writeFileSync(
      join(temporary, "bin/bcr-runner"),
      '#!/bin/sh\nset -eu\nrunner_install=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$runner_install/runtime/bun" "$runner_install/dist/cli.js" "$@"\n',
      { mode: 0o755 },
    );
    await run([
      "tar",
      "-czf",
      join(out, `bcr-runner-${process.platform}-${process.arch}.tar.gz`),
      "-C",
      temporary,
      ".",
    ]);
  }
  process.stdout.write(
    `${JSON.stringify({ directory: packageDirectory, version: source.version, portable: values.portable ?? false })}\n`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
