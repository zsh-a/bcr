/** A distributed package must create the same standard Work without the BCR checkout. */
import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const temp = mkdtempSync(join(tmpdir(), "bcr-work-package-"));
const source = resolve("dist/work-runner/package");
assert(existsSync(source), "run bun run build:runner first");
const installation = join(temp, "installation");
cpSync(source, installation, { recursive: true });
async function run(args, cwd = installation) {
  const child = Bun.spawn(args, {
    cwd,
    env: {
      ...process.env,
      BCR_WORK_STATE: join(temp, "engine-state"),
      BCR_WORK_CACHE: join(temp, "cache"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, `${stderr}\n${stdout}`);
  return stdout;
}
try {
  await run([process.execPath, "install", "--frozen-lockfile", "--production", "--ignore-scripts"]);
  const version = JSON.parse(await run([process.execPath, "dist/cli.js", "version", "--json"]));
  assert.equal(version.version, "0.3.0");
  assert(existsSync(join(installation, "engine/audio/uv.lock")));
  assert(!existsSync(join(installation, "starter")));
  const workspace = join(temp, "works");
  mkdirSync(workspace);
  writeFileSync(
    join(workspace, "workspace.json"),
    JSON.stringify({ version: 1, cacheBudgetGiB: 8, projects: [] }),
  );
  const created = JSON.parse(
    await run([
      process.execPath,
      "dist/work.js",
      "--root",
      workspace,
      "init",
      "package-work",
      "--title",
      "独立包作品",
      "--json",
    ]),
  );
  assert(created.dependenciesInstalled);
  const work = JSON.parse(readFileSync(join(created.path, "work.json"), "utf8"));
  assert.deepEqual(
    work.targets.map((target) => target.id),
    ["main", "cover", "cover-4x3"],
  );
  const pkg = JSON.parse(readFileSync(join(created.path, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.remotion, pkg.dependencies["@remotion/player"]);
  assert(
    !existsSync(join(workspace, ".tools")),
    "new templates do not require the compatibility link",
  );
  await run([process.execPath, "run", "typecheck"], created.path);
  await run([process.execPath, "run", "lint"], created.path);
  const independent = JSON.parse(
    await run([
      process.execPath,
      "dist/cli.js",
      "create",
      join(temp, "independent"),
      "--id",
      "independent",
      "--no-install",
      "--json",
    ]),
  );
  assert.deepEqual(
    independent.work.targets.map((target) => target.id),
    work.targets.map((target) => target.id),
  );
  console.log(
    JSON.stringify({
      passed: true,
      standalonePackage: true,
      commonTemplate: true,
      templatesNeedNoToolsLink: true,
      typecheckAndBiome: true,
    }),
  );
} finally {
  rmSync(temp, { recursive: true, force: true });
}
