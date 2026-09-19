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

export function readerErrorMessage(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  const normalized = message.toLocaleLowerCase();
  if (normalized.includes("password") || normalized.includes("encrypted"))
    return "PDF 受密码保护，请先解除密码后重试";
  if (normalized.includes("invalidpdf") || normalized.includes("invalid pdf"))
    return "PDF 文件格式无法识别，请换用有效文件";
  if (normalized.includes("fetch") || normalized.includes("network"))
    return "PDF 文件读取失败，请检查文件后重试";
  return `${fallback}，请重试`;
}
