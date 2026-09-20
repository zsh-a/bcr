import { existsSync, readFileSync, readdirSync } from "node:fs";
import { defineConfig } from "vite-plus";

/**
 * Workspace root configuration.
 *
 * This file is the single source of truth for the shared toolchain (format,
 * lint, tests, task graph). Package-local `vite.config.ts` files stay inside
 * each app and only carry what is genuinely app-specific (plugins, dev port,
 * COOP/COEP headers).
 */

/**
 * Runtime dependency boundaries.
 *
 * Each entry lists the *only* `@bcr/*` packages a workspace may import; every
 * other workspace package is rejected by `no-restricted-imports`. This keeps
 * the layering documented in `docs/RUNTIME-ARCHITECTURE.md` enforced by the
 * linter instead of by a bespoke AST script.
 *
 * Overrides must not overlap: a workspace matches exactly one entry, because
 * a later `lint.overrides` entry replaces an earlier one for the same file
 * rather than merging with it.
 */
const boundaries: { dir: string; allow: string[]; message: string }[] = [
  {
    dir: "packages/scene-renderer",
    allow: [],
    message: "@bcr/scene-renderer is a leaf renderer and must stay dependency-free.",
  },
  {
    dir: "packages/core",
    allow: ["@bcr/storage-opfs"],
    message: "@bcr/core may only depend on @bcr/storage-opfs.",
  },
  {
    dir: "packages/runtime-worker",
    allow: ["@bcr/core", "@bcr/storage-opfs"],
    message: "@bcr/runtime-worker may only depend on @bcr/core and @bcr/storage-opfs.",
  },
  {
    dir: "packages/runtime-browser",
    allow: ["@bcr/core", "@bcr/storage-opfs", "@bcr/storage-sqlite"],
    message:
      "@bcr/runtime-browser may only depend on @bcr/core, @bcr/storage-opfs and @bcr/storage-sqlite.",
  },
];

/** Raw-source reach-through, rejected everywhere. */
const internalSubpaths = ["@bcr/*/src/*", "@bcr/*/dist/*"];

/** The host, which is the only workspace allowed to import app packages. */
const HOST_DIR = "apps/studio";

/**
 * App package names, e.g. `@bcr/reader-studio`.
 *
 * Read from the manifests' packages rather than hard-coded, so a new app is
 * covered by the cross-app rule the moment its package exists.
 */
function appPackageNames(): string[] {
  return ["apps", "packages"].flatMap((group) =>
    readdirSync(new URL(`${group}/`, import.meta.url), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(new URL(`${group}/${entry.name}/package.json`, import.meta.url)),
      )
      .map((entry) => `${group}/${entry.name}`)
      .filter((dir) => existsSync(new URL(`${dir}/src/app-manifest.ts`, import.meta.url)))
      .map((dir) => {
        const manifest = readFileSync(new URL(`${dir}/package.json`, import.meta.url), "utf8");
        return /"name":\s*"([^"]+)"/u.exec(manifest)?.[1] ?? "";
      })
      .filter((name) => name.length > 0),
  );
}

/** Every `apps/*`, `packages/*` and `examples/*` workspace directory. */
function workspaceDirs() {
  return ["apps", "packages", "examples"].flatMap((group) =>
    readdirSync(new URL(`${group}/`, import.meta.url), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(new URL(`${group}/${entry.name}/package.json`, import.meta.url)),
      )
      .map((entry) => `${group}/${entry.name}`),
  );
}

/**
 * One override per workspace, with the raw-source rule folded into each so the
 * two never conflict: a restricted workspace gets `internalSubpaths` plus the
 * allowlisted `@bcr/*` family, an unrestricted one gets only `internalSubpaths`.
 */
function boundaryOverrides(apps: ReadonlyArray<string>) {
  const restricted: Record<string, (typeof boundaries)[number]> = Object.fromEntries(
    boundaries.map((entry) => [entry.dir, entry]),
  );
  return workspaceDirs().map((dir) => {
    const entry = restricted[dir];
    const message =
      entry?.message ??
      "Import a package's declared export instead of reaching into its source tree.";
    const crossApp =
      dir === HOST_DIR
        ? []
        : [
            {
              group: apps.map((name) => `${name}/*`),
              message:
                "App packages are only composed by the host; share behaviour through a @bcr/*-core package or the host instead.",
            },
          ];
    return {
      files: [`${dir}/**`],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              ...crossApp,
              { group: internalSubpaths, message },
              // `undefined` means the workspace has no allowlist restriction;
              // an empty array means it may import no `@bcr/*` package at all.
              ...(entry === undefined
                ? []
                : [
                    {
                      group: ["@bcr/*", ...entry.allow.map((name) => `!${name}`)],
                      message,
                    },
                  ]),
            ],
          },
        ],
      },
    };
  });
}

export default defineConfig({
  fmt: {
    ignorePatterns: ["**/dist/**", "**/node_modules/**", "crates/kernels/pkg/**"],
  },
  lint: {
    options: {
      // Type-aware rules only. `typeCheck` is deliberately NOT enabled: the
      // tsgolint type checker reports false positives on `vite.config.ts`
      // (TS2321/TS2769) and on legitimate ambient `declare module` blocks that
      // `tsc` accepts. Full type checking runs through `tsrun typecheck`.
      typeAware: true,
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
    overrides: [
      {
        // Node-side走查脚本：stdout 是其主要输出通道。
        files: ["scripts/**", "**/tests/**"],
        rules: { "no-console": "off" },
      },
      ...boundaryOverrides(appPackageNames()),
    ],
  },
  test: {
    environment: "node",
    include: ["{packages,apps}/*/tests/**/*.test.ts"],
  },
});
