/**
 * 阅读体验设置：字体（无衬线/衬线）、行高（紧凑/标准/宽松）与打字机模式。
 * 知识模块暂无全局设置存储，按约定落在 localStorage `bcr.knowledge.reading`（v1）。
 */

export interface ReadingSettings {
  readonly font: "sans" | "serif";
  readonly lineHeight: "compact" | "standard" | "loose";
  readonly typewriter: boolean;
}

export const READING_SETTINGS_KEY = "bcr.knowledge.reading";

export const defaultReadingSettings: ReadingSettings = {
  font: "sans",
  lineHeight: "standard",
  typewriter: false,
};

export function decodeReadingSettings(raw: string | null): ReadingSettings {
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1) return defaultReadingSettings;
    return {
      font: value.font === "serif" ? "serif" : "sans",
      lineHeight:
        value.lineHeight === "compact" || value.lineHeight === "loose"
          ? value.lineHeight
          : "standard",
      typewriter: value.typewriter === true,
    };
  } catch {
    return defaultReadingSettings;
  }
}
