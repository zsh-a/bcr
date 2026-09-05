import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const projects = (
  await Promise.all(
    manifest.workspaces.map(async (pattern) => {
      if (!pattern.endsWith("/*")) throw new Error(`Unsupported workspace pattern: ${pattern}`);
      const directory = pattern.slice(0, -1);
      return (await readdir(new URL(directory, root), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${directory}${entry.name}/tsconfig.json`)
        .filter((path) => existsSync(new URL(path, root)));
    }),
  )
)
  .flat()
  .sort();
const queue = [...projects];
let failures = 0;

async function check() {
  for (;;) {
    const project = queue.shift();
    if (project === undefined) return;
    const ok = await new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          fileURLToPath(new URL("node_modules/typescript/bin/tsc", root)),
          "--noEmit",
          "-p",
          project,
        ],
        { cwd: fileURLToPath(root), stdio: "inherit" },
      );
      child.once("error", (error) => {
        console.error(`${project}: ${error.message}`);
        resolve(false);
      });
      child.once("exit", (code) => resolve(code === 0));
    });
    if (!ok) failures += 1;
  }
}
await Promise.all(Array.from({ length: Math.min(4, projects.length) }, check));
console.log(`Typechecked ${projects.length} workspaces; ${failures} failed.`);
if (failures > 0) process.exitCode = 1;
