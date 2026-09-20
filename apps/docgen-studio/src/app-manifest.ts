import { FileBadge } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * DocGen Lab — fictional utility-bill generator.
 *
 * `section: null` keeps the route registered and reachable by URL and through
 * the command palette without advertising it on the launch pad: its output is
 * synthetic input for the other pipelines (OCR, translation, reading), not user
 * content of its own.
 */
export const manifest = {
  id: "docgen",
  title: "DocGen Lab",
  path: "/docgen",
  icon: FileBadge,
  description: "虚构账单生成 · 模板渲染 / 水印 / 实拍合成 · 纯端侧",
  section: null,
  load: () => import("./App"),
} as const satisfies AppManifest;
