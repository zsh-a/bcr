import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold";

test("starter scaffolds a portable multi-target Work with customized identity", () => {
  const root = mkdtempSync(join(tmpdir(), "bcr-scaffold-"));
  try {
    const result = scaffold({
      directory: join(root, "coffee-notes"),
      template: "starter",
      id: "coffee-notes",
      title: "咖啡，自己做还是外卖？",
    });
    expect(result.work).toMatchObject({ id: "coffee-notes", title: "咖啡，自己做还是外卖？" });
    expect(result.work.targets.map((target) => target.id)).toEqual(["page", "vertical"]);
    expect(existsSync(join(result.directory, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(result.directory, "bun.lock"))).toBe(true);
    expect(existsSync(join(result.directory, "src/three/CostStage.tsx"))).toBe(true);
    expect(JSON.parse(readFileSync(join(result.directory, "package.json"), "utf8"))).toMatchObject({
      dependencies: { "@remotion/three": "4.0.532", three: "0.178.0" },
    });
    const work = JSON.parse(readFileSync(join(result.directory, "work.json"), "utf8"));
    expect(work).toMatchObject({ format: "bcr-project-1", id: "coffee-notes" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("starter derives an ID and readable title when identity is omitted", () => {
  const root = mkdtempSync(join(tmpdir(), "bcr-scaffold-"));
  try {
    const result = scaffold({ directory: join(root, "daily-costs"), template: "starter" });
    expect(result.work).toMatchObject({ id: "daily-costs", title: "Daily Costs" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
