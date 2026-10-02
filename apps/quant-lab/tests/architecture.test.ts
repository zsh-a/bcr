import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../src");
const list = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? list(file) : /\.tsx?$/u.test(file) ? [file] : [];
  });
const files = list(root);
const paths = new Set(files);
const dependencies = files.map((file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  return {
    file,
    imports: source.statements.flatMap((node) => {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) return [];
      const clause = node.importClause;
      if (
        clause?.isTypeOnly ||
        (!clause?.name &&
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every((element) => element.isTypeOnly))
      )
        return [];
      const specifier = node.moduleSpecifier.text;
      const resolved = specifier.startsWith(".")
        ? ["", ".ts", ".tsx"]
            .map((extension) => path.resolve(path.dirname(file), specifier + extension))
            .find((candidate) => paths.has(candidate))
        : undefined;
      return [{ specifier, resolved }];
    }),
  };
});

describe("Quant application boundaries", () => {
  it("keeps non-view code independent of React components and UI packages", () => {
    const violations = dependencies.flatMap(({ file, imports }) => {
      if (file.endsWith(".tsx") || /^use[A-Z]/u.test(path.basename(file))) return [];
      return imports
        .filter(
          ({ specifier, resolved }) =>
            specifier === "react" ||
            specifier.startsWith("@bcr/react") ||
            resolved?.endsWith(".tsx"),
        )
        .map(({ specifier }) => `${path.relative(root, file)} → ${specifier}`);
    });
    expect(violations).toEqual([]);
  });

  it("has no runtime import cycles inside the application", () => {
    const graph = new Map(
      dependencies.map(({ file, imports }) => [
        file,
        imports.flatMap(({ resolved }) => (resolved ? [resolved] : [])),
      ]),
    );
    const visited = new Set<string>(),
      active = new Set<string>();
    const visit = (file: string, chain: string[]) => {
      if (active.has(file))
        throw new Error([...chain, file].map((name) => path.relative(root, name)).join(" → "));
      if (visited.has(file)) return;
      active.add(file);
      for (const dependency of graph.get(file) ?? []) visit(dependency, [...chain, file]);
      active.delete(file);
      visited.add(file);
    };
    for (const file of files) visit(file, []);
  });
});
