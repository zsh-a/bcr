import { useSyncExternalStore } from "react";
import type { ChartPalette } from "../macro/chartStyle";

const FALLBACK: ChartPalette = {
  text: "#292b2d",
  muted: "#7a7d80",
  border: "#d9dcde",
  surface: "#fafaf8",
  colors: ["#347e8a", "#b46c43", "#6e86a7", "#a28652", "#7d8f6d", "#a56c7a"],
};
const TOKENS = [
  "--color-accent",
  "--color-info",
  "--color-amber",
  "--color-danger",
  "--color-success",
  "--color-muted",
];
let snapshot = FALLBACK;
const subscribers = new Set<() => void>();
let cleanup: (() => void) | undefined;

export function resolveResearchColor(color: string): string {
  if (typeof document === "undefined") return color;
  const token = /^var\((--[\w-]+)\)$/u.exec(color)?.[1];
  return token
    ? getComputedStyle(document.documentElement).getPropertyValue(token).trim() || color
    : color;
}
function refresh() {
  const style = getComputedStyle(document.documentElement),
    read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const next = {
    text: read("--color-text", FALLBACK.text),
    muted: read("--color-faint", FALLBACK.muted),
    border: read("--color-border", FALLBACK.border),
    surface: read("--color-surface", FALLBACK.surface),
    colors: FALLBACK.colors.map((fallback, index) => read(TOKENS[index]!, fallback)),
  };
  if (JSON.stringify(next) === JSON.stringify(snapshot)) return;
  snapshot = next;
  subscribers.forEach((subscriber) => subscriber());
}
function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  if (!cleanup) {
    const observer = new MutationObserver(refresh),
      scheme = matchMedia("(prefers-color-scheme: dark)");
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "style"],
    });
    scheme.addEventListener("change", refresh);
    cleanup = () => {
      observer.disconnect();
      scheme.removeEventListener("change", refresh);
    };
    refresh();
  }
  return () => {
    subscribers.delete(subscriber);
    if (!subscribers.size) {
      cleanup?.();
      cleanup = undefined;
    }
  };
}
/** Every visible research chart shares one theme observer and one palette snapshot. */
export function useResearchPalette(): ChartPalette {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => FALLBACK,
  );
}
