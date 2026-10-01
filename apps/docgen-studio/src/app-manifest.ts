import { FileBadge } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * DocGen Lab — fictional utility-bill generator.
 *
 * Available under developer tools and in the command palette. Its synthetic
 * output exercises OCR, translation and reading pipelines, so it stays outside
 * the primary launch pad.
 */
export const manifest = {
  id: "docgen",
  title: "DocGen Lab",
  path: "/docgen",
  icon: FileBadge,
  description: "生成虚构账单，用于识别与阅读流程验证",
  section: "developer",
  load: () => import("./App"),
} as const satisfies AppManifest;
