import { Archive, FileText, Leaf, Moon, Sun } from "lucide-react";
import type { ReaderBook } from "@bcr/reader-core";
import type { ReaderTheme } from "./model";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatBadge(format: ReaderBook["source"]["format"]): string {
  return format === "markdown" ? "MD" : format.toUpperCase();
}

export function themeIcon(theme: ReaderTheme) {
  if (theme === "night") return <Moon className="reader-icon" />;
  if (theme === "sage") return <Leaf className="reader-icon" />;
  return <Sun className="reader-icon" />;
}

export function themeLabel(theme: ReaderTheme): string {
  if (theme === "night") return "夜间";
  if (theme === "sage") return "松石";
  return "纸张";
}

export function sourceIcon(format: ReaderBook["source"]["format"]) {
  return format === "cbz" ? (
    <Archive className="reader-icon" />
  ) : (
    <FileText className="reader-icon" />
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
