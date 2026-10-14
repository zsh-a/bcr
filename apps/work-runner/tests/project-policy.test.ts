import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProject, targetIdentity } from "@bcr/work-engine";
import { Projects } from "../src/projects";

const temporary = mkdtempSync(join(tmpdir(), "runner-project-policy-"));
afterAll(() => rmSync(temporary, { recursive: true, force: true }));

test("snapshots include declared compiled inputs, omit private media, and restore compiled state", () => {
  const root = join(temporary, "work");
  mkdirSync(join(root, ".bcr/build/runtime"), { recursive: true });
  mkdirSync(join(root, "media"));
  writeFileSync(join(root, "media/private.wav"), "private");
  truncateSync(join(root, "media/private.wav"), 70 * 1024 ** 2);
  writeFileSync(join(root, "index.html"), "<h1>Work</h1>");
  writeFileSync(
    join(root, "work.json"),
    JSON.stringify({
      format: "bcr-project-1",
      id: "policy-work",
      title: "Policy",
      targets: [{ id: "main", runtime: "html", entry: "index.html" }],
    }),
  );
  writeFileSync(
    join(root, "production.json"),
    JSON.stringify({
      version: 1,
      privateAssets: [],
      targets: {},
      runtime: {
        cues: "cues.json",
        timing: ".bcr/build/runtime/timing.json",
        events: ".bcr/build/runtime/events.json",
      },
    }),
  );
  for (const name of ["timing", "events", "manifest"]) {
    writeFileSync(join(root, `.bcr/build/runtime/${name}.json`), '{"value":1}');
  }
  const projects = new Projects(root, join(temporary, "state"));
  const first = projects.read("policy-work");
  expect(first.files.some((file) => file.path.startsWith("media/"))).toBe(false);
  expect(first.files.some((file) => file.path === ".bcr/build/runtime/timing.json")).toBe(true);
  projects.snapshot("policy-work", first.revision);
  writeFileSync(join(root, ".bcr/build/runtime/timing.json"), '{"value":2}');
  const second = projects.read("policy-work");
  projects.snapshot("policy-work", second.revision);
  expect(second.revision).not.toBe(first.revision);
  projects.applySnapshot(second, first);
  expect(readFileSync(join(root, ".bcr/build/runtime/timing.json"), "utf8")).toBe('{"value":1}');
  expect(readFileSync(join(root, "media/private.wav")).length).toBe(70 * 1024 ** 2);
});

test("CLI and Runner resolve the same experiment targets from live and preserved source", () => {
  const root = join(temporary, "experiments-work");
  mkdirSync(join(root, "experiments"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<h1>Main</h1>");
  writeFileSync(join(root, "experiments/trial.html"), "<h1>Trial</h1>");
  const work = {
    format: "bcr-project-1",
    id: "experiment-work",
    title: "Experiments",
    targets: [{ id: "main", runtime: "html", entry: "index.html" }],
  };
  writeFileSync(join(root, "work.json"), JSON.stringify(work));
  writeFileSync(
    join(root, "production.json"),
    JSON.stringify({
      version: 1,
      privateAssets: [],
      targets: {},
      experiments: "experiments/targets.json",
    }),
  );
  const experiments = join(root, "experiments/targets.json");
  writeFileSync(
    experiments,
    JSON.stringify({
      version: 1,
      targets: [{ id: "trial", runtime: "html", entry: "experiments/trial.html" }],
    }),
  );
  const projects = new Projects(root, join(temporary, "experiments-state"));
  const first = projects.read("experiment-work");
  const cli = loadProject(root);
  expect(first.targets.map((target) => target.id)).toEqual(
    cli.work.targets.map((target) => target.id),
  );
  expect(first.targets.map((target) => target.id)).toEqual(["main", "trial"]);
  expect(cli.experimentIds?.has("trial")).toBe(true);
  expect(targetIdentity(cli, first.targets[1]!).key).toBe(
    targetIdentity(cli, cli.work.targets[1]!).key,
  );
  projects.snapshot("experiment-work", first.revision);
  const manifestPath = join(projects.source(first.revision), "../manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Earlier Runner metadata omitted experiment targets; the preserved source is authoritative.
  manifest.targets = work.targets;
  manifest.definition.targets = work.targets;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const preservedManifest = readFileSync(manifestPath, "utf8");
  expect(
    projects.snapshot("experiment-work", first.revision).targets.map((target) => target.id),
  ).toEqual(["main", "trial"]);
  expect(readFileSync(manifestPath, "utf8")).toBe(preservedManifest);
  writeFileSync(
    experiments,
    JSON.stringify({
      version: 1,
      targets: [{ id: "replacement", runtime: "html", entry: "experiments/trial.html" }],
    }),
  );
  expect(projects.read("experiment-work").targets.map((target) => target.id)).toEqual([
    "main",
    "replacement",
  ]);
  expect(
    projects.snapshot("experiment-work", first.revision).targets.map((target) => target.id),
  ).toEqual(["main", "trial"]);
  writeFileSync(experiments, JSON.stringify({ version: 1, targets: work.targets }));
  expect(() => projects.read("experiment-work")).toThrow("目标 ID 重复");
  expect(() => loadProject(root)).toThrow("目标 ID 重复");
});
