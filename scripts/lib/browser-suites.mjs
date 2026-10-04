import { parseArgs } from "node:util";

// Core checks cover user workflows and data integrity. Detailed visual and
// format permutations stay available in the manually triggered full suite.
const coreChecks = new Set([
  "media-studio",
  "general-agent-chat",
  "credentials",
  "diagram",
  "workspace-navigation",
  "session-isolation",
  "document-studio",
  "data-studio",
  "manga-studio",
  "market-trends",
  "jsg",
  "binance-trend",
  "binance-kdj",
  "binance-price-action",
  "binance-structured-pullback",
  "quant-chart-events",
  "jsg-clickhouse-fixture",
  "quant-experiments",
  "quant-walk-forward",
  "research",
  "research-package",
  "research-recovery",
  "reader-studio",
  "reader-txt-flow",
  "reader-tools",
  "reader-pdf-experience",
  "knowledge-workbench",
  "knowledge-attachments",
  "knowledge-change-plan",
  "resource-layout",
]);

const groups = {
  workspace: [
    "media-studio",
    "windowed-asr",
    "general-agent-chat",
    "diagram",
    "agent-conversations",
    "credentials",
    "shell-architecture",
    "home-organization",
    "workspace-navigation",
    "app-layout",
    "modern-ui",
    "persistence",
    "market-trends",
    "manga-studio",
    "document-studio",
    "data-studio",
    "storage-cleanup",
    "global-search",
    "theme",
    "background",
    "accessibility",
    "responsive",
    "runtime-lifecycle",
    "session-isolation",
  ],
  quant: [
    "quant-lab",
    "jsg",
    "binance-trend",
    "binance-kdj",
    "binance-price-action",
    "binance-structured-pullback",
    "quant-chart-events",
    "jsg-storage",
    "jsg-grid",
    "jsg-research",
    "quant-experiments",
    "quant-walk-forward",
    "jsg-evaluation",
    "jsg-features",
    "jsg-layout",
    "jsg-clickhouse-fixture",
    "research",
    "research-backup",
    "research-search",
    "research-package",
    "research-recovery",
    "research-import-staging",
    "research-volumes",
    "research-stream",
    "research-task",
    "research-package-cancel",
  ],
  reader: [
    "knowledge-agent-writes",
    "reader-studio",
    "reader-capture",
    "reader-large-txt",
    "reader-content",
    "reader-mobile",
    "reader-mobile-footer",
    "mobile-knowledge-reader",
    "reader-alignment",
    "reader-typography",
    "reader-pagination",
    "reader-txt-pagination",
    "reader-txt-flow",
    "reader-focus",
    "reader-audit",
    "reader-library",
    "reader-context-menu",
    "reader-toolbar",
    "reader-navigation-ui",
    "reader-restore-records",
    "reader-page-height",
    "reader-page-turn",
    "reader-tools",
    "reader-pdf-experience",
    "reader-comics",
    "knowledge",
    "knowledge-workbench",
    "resource-layout",
    "knowledge-typography",
    "knowledge-change-plan",
    "knowledge-paths",
    "knowledge-dialogs",
    "knowledge-restore",
    "knowledge-attachments",
    "knowledge-editor-context",
  ],
};

export const browserGroupNames = Object.keys(groups);

export function parseBrowserOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      suite: { type: "string", default: "core" },
      group: { type: "string" },
      list: { type: "boolean", default: false },
    },
  });
  if (!["core", "full"].includes(values.suite)) {
    throw new Error(`Unknown browser suite: ${values.suite}. Use core or full.`);
  }
  if (values.group !== undefined && !browserGroupNames.includes(values.group)) {
    throw new Error(`Unknown browser group: ${values.group}. Use ${browserGroupNames.join(", ")}.`);
  }
  return values;
}

export function selectBrowserGroups({ suite = "core", group, liveMarkets = false } = {}) {
  const options = parseBrowserOptions([
    `--suite=${suite}`,
    ...(group === undefined ? [] : [`--group=${group}`]),
  ]);
  return browserGroupNames
    .filter((name) => !options.group || options.group === name)
    .map((name) => ({
      name,
      checks: [
        ...groups[name].filter((check) => suite === "full" || coreChecks.has(check)),
        ...(liveMarkets && name === "workspace" ? ["market-atlas"] : []),
      ].map((check) => ({
        script: `scripts/verify-${check}.mjs`,
        app: ["media-studio", "windowed-asr"].includes(check) ? "media" : "studio",
      })),
    }));
}
