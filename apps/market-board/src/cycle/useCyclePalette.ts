import { useEffect, useState } from "react";
import type { ChartPalette } from "../macro/chartStyle";
import { SERIES_TOKENS } from "../macro/state";

export function useCyclePalette(): ChartPalette {
  const read = () => {
    const style = getComputedStyle(document.documentElement),
      color = (name: string) => style.getPropertyValue(name).trim();
    return {
      text: color("--color-text"),
      muted: color("--color-faint"),
      border: color("--color-border"),
      surface: color("--color-surface"),
      colors: SERIES_TOKENS.map(color),
    };
  };
  const [palette, setPalette] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setPalette(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => observer.disconnect();
  }, []);
  return palette;
}
