import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const workspaces = ["apps", "packages"].flatMap((group) =>
  readdirSync(path.join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, group, entry.name))
    .filter((dir) => existsSync(path.join(dir, "package.json")))
    .map((dir) => ({
      dir,
      manifest: JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
        name: string;
        exports?: Record<string, string>;
      },
    })),
);
const packages = new Map(workspaces.map((workspace) => [workspace.manifest.name, workspace]));
const list = (dir: string): string[] =>
  !existsSync(dir)
    ? []
    : readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const file = path.join(dir, entry.name);
        return entry.isDirectory() ? list(file) : /\.tsx?$/u.test(file) ? [file] : [];
      });
const files = workspaces.flatMap(({ dir }) => list(path.join(dir, "src")));
const paths = new Set(files);
const relative = (file: string) => path.relative(root, file);

function resolve(file: string, specifier: string): string | undefined {
  let target: string | undefined;
  if (specifier.startsWith(".")) target = path.resolve(path.dirname(file), specifier);
  else if (specifier.startsWith("@bcr/")) {
    const parts = specifier.split("/");
    const workspace = packages.get(parts.slice(0, 2).join("/"));
    const key = parts.length === 2 ? "." : `./${parts.slice(2).join("/")}`;
    const exports = workspace?.manifest.exports;
    let entry = exports?.[key];
    if (!entry && exports)
      for (const [pattern, value] of Object.entries(exports)) {
        const [prefix, suffix] = pattern.split("*");
        if (suffix !== undefined && key.startsWith(prefix!) && key.endsWith(suffix)) {
          const capture = key.slice(prefix!.length, suffix ? -suffix.length : undefined);
          entry = value.replace("*", capture);
          break;
        }
      }
    if (entry && workspace) target = path.resolve(workspace.dir, entry);
  }
  return target
    ? [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`].find(
        (candidate) => paths.has(candidate),
      )
    : undefined;
}

const dependencies = files.map((file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const imports = source.statements.flatMap((node) => {
    if (
      (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
      !node.moduleSpecifier ||
      !ts.isStringLiteral(node.moduleSpecifier)
    )
      return [];
    const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
    if ((ts.isExportDeclaration(node) && node.isTypeOnly) || clause?.isTypeOnly) return [];
    const binding =
      clause?.namedBindings ?? (ts.isExportDeclaration(node) ? node.exportClause : undefined);
    if (
      !clause?.name &&
      binding &&
      (ts.isNamedImports(binding) || ts.isNamedExports(binding)) &&
      binding.elements.every((element) => element.isTypeOnly)
    )
      return [];
    const specifier = node.moduleSpecifier.text;
    return [{ specifier, target: resolve(file, specifier) }];
  });
  return { file, imports };
});

describe("Workspace architecture", () => {
  it("points every literal package export at an existing file", () => {
    const missing = workspaces.flatMap(({ dir, manifest }) =>
      Object.entries(manifest.exports ?? {}).flatMap(([key, target]) =>
        target.includes("*") || existsSync(path.resolve(dir, target))
          ? []
          : [`${manifest.name}${key.slice(1)} → ${target}`],
      ),
    );
    expect(missing).toEqual([]);
  });

  it("keeps static runtime dependencies acyclic, including package exports", () => {
    const graph = new Map(
      dependencies.map(({ file, imports }) => [
        file,
        imports.flatMap(({ target }) => (target ? [target] : [])),
      ]),
    );
    const visited = new Set<string>(),
      active = new Set<string>();
    const visit = (file: string, chain: string[]) => {
      if (active.has(file)) throw new Error([...chain, file].map(relative).join(" → "));
      if (visited.has(file)) return;
      active.add(file);
      for (const target of graph.get(file) ?? []) visit(target, [...chain, file]);
      active.delete(file);
      visited.add(file);
    };
    for (const file of files) visit(file, []);
  });

  it("keeps domain state, persistence, and computation independent of React views", () => {
    const violations = dependencies.flatMap(({ file, imports }) => {
      const name = relative(file);
      const domain =
        name.startsWith("packages/reader-studio/src/") ||
        name.startsWith("apps/manga-studio/src/") ||
        /^apps\/studio\/src\/knowledge\/(?:session|notes|storage)\//u.test(name) ||
        /^(?:apps\/(?:studio|media-studio)|packages\/document-studio)\/src\/store\.ts$/u.test(name);
      if (!domain || file.endsWith(".tsx") || /^use[A-Z]/u.test(path.basename(file))) return [];
      return imports
        .filter(
          ({ specifier, target }) =>
            specifier === "react" || specifier.startsWith("@bcr/react") || target?.endsWith(".tsx"),
        )
        .map(({ specifier }) => `${name} → ${specifier}`);
    });
    expect(violations).toEqual([]);
  });
});
