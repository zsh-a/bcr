import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../", import.meta.url));
async function sources(directory) {
  return (
    await Promise.all(
      (await readdir(directory, { withFileTypes: true })).map(async (entry) => {
        const file = path.join(directory, entry.name);
        return entry.isDirectory() ? sources(file) : /\.tsx?$/.test(file) ? [file] : [];
      }),
    )
  ).flat();
}
const rules = [
  ["packages/core/src", new Set(["@bcr/storage-opfs"])],
  ["packages/runtime-worker/src", new Set(["@bcr/core", "@bcr/storage-opfs"])],
  [
    "packages/runtime-browser/src",
    new Set(["@bcr/core", "@bcr/storage-opfs", "@bcr/storage-sqlite"]),
  ],
  ["apps/studio/src", undefined],
];
const failures = [];
for (const [directory, allowed] of rules) {
  for (const file of await sources(path.join(root, directory))) {
    const ast = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const inspect = (node) => {
      const specifier =
        ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
          ? node.moduleSpecifier
          : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            ? node.arguments[0]
            : undefined;
      if (specifier && ts.isStringLiteral(specifier)) {
        const target = specifier.text;
        if (target.startsWith("@bcr/")) {
          const packageName = target.split("/").slice(0, 2).join("/");
          const forbidden = allowed
            ? !allowed.has(packageName)
            : /^@bcr\/[^/]+\/store$/.test(target);
          if (forbidden) failures.push(`${path.relative(root, file)} → ${target}`);
        }
      }
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
  }
}
if (failures.length) {
  console.error("Architecture boundary violations:\n" + failures.join("\n"));
  process.exitCode = 1;
} else console.log("Runtime dependency boundaries verified.");
