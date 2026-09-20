import { Table2 } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/** Data Studio — local tabular exploration over CSV / JSON / NDJSON. */
/** Operations this app contributes to the host compute worker. */
const DATA_COMPUTE = {
  module: () => import("./compute"),
  backends: { wasm: [], js: ["data.parse.table"] },
} as const;

export const manifest = {
  id: "data",
  title: "Data Studio",
  path: "/data",
  icon: Table2,
  description: "本地表格探索 · CSV / JSON / NDJSON · Schema / 搜索 / 导出",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    query: typeof search["query"] === "string" ? search["query"] : undefined,
  }),
  compute: DATA_COMPUTE,
} as const satisfies AppManifest;
