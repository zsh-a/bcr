import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scaffold } from "../src/scaffold";

test("create uses the same standard production template as init", async () => {
  const root = mkdtempSync(join(tmpdir(), "bcr-scaffold-"));
  try {
    const result = await scaffold({
      directory: join(root, "coffee-notes"),
      template: "video",
      install: false,
      id: "coffee-notes",
      title: "咖啡，自己做还是外卖？",
    });
    expect(result.work).toMatchObject({ id: "coffee-notes", title: "咖啡，自己做还是外卖？" });
    expect(result.work.targets.map((target) => target.id)).toEqual(["main", "cover", "cover-4x3"]);
    expect(existsSync(join(result.directory, "AGENTS.md"))).toBe(true);
    expect(existsSync(join(result.directory, "production.json"))).toBe(true);
    expect(existsSync(join(result.directory, "src/Scene.tsx"))).toBe(true);
    expect(JSON.parse(readFileSync(join(result.directory, "package.json"), "utf8"))).toMatchObject({
      dependencies: { "@remotion/player": "4.0.532", remotion: "4.0.532" },
    });
    const work = JSON.parse(readFileSync(join(result.directory, "work.json"), "utf8"));
    expect(work).toMatchObject({ format: "bcr-project-1", id: "coffee-notes" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("create derives an ID and readable title when identity is omitted", async () => {
  const root = mkdtempSync(join(tmpdir(), "bcr-scaffold-"));
  try {
    const result = await scaffold({
      directory: join(root, "daily-costs"),
      template: "video",
      install: false,
    });
    expect(result.work).toMatchObject({ id: "daily-costs", title: "Daily Costs" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
