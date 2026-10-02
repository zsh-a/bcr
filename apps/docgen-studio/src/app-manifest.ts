import { definition } from "./app-definition";
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
  ...definition,
  icon: FileBadge,
  load: () => import("./App"),
} as const satisfies AppManifest;
