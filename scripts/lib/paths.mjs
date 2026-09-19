import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Workspace package lookup for the `verify-*.mjs`走查 scripts.
 *
 * Several scripts locate real modules on the running dev server by matching
 * request paths (Vite serves module URLs derived from the on-disk path), and a
 * few `require()` a package's own dependencies. Both were previously spelled as
 * literal `apps/<name>/...` strings, so moving a directory silently broke them.
 * These helpers keep the location in one place.
 */

/**
 * Absolute directory of a workspace studio package.
 *
 * @param {string} name package stem, e.g. `"reader"`
 */
export function packageDir(name) {
  return fileURLToPath(new URL(`../../packages/${name}-studio/`, import.meta.url));
}

/**
 * The path prefix Vite uses when serving a package's source modules.
 *
 * Use this inside `page.evaluate` callbacks, which run in the browser and
 * cannot call {@link moduleSuffix} directly.
 *
 * @param {string} name package stem, e.g. `"reader"`
 */
export function modulePrefix(name) {
  return `/packages/${name}-studio/src/`;
}

/**
 * The path suffix Vite uses when serving one of a package's source modules.
 *
 * Scripts `import()` live modules by matching resource-request paths against
 * this suffix, so it must track the package's real directory.
 *
 * @param {string} name package stem, e.g. `"reader"`
 * @param {string} file module filename, e.g. `"store.ts"`
 */
export function moduleSuffix(name, file) {
  return modulePrefix(name) + file;
}

/**
 * A `createRequire` rooted at a workspace package, for reading that package's
 * own devDependencies (pdfjs, zip.js) from a走查 script.
 *
 * @param {string} name package stem, e.g. `"reader"`
 */
export function requireFrom(name) {
  return createRequire(new URL(`../../packages/${name}-studio/package.json`, import.meta.url));
}
