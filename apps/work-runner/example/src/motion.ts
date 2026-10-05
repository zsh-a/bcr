import { Easing, interpolate } from "remotion";

export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const progress = (frame: number, from: number, duration: number) =>
  interpolate(frame, [from, from + Math.max(1, duration)], [0, 1], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
export const money = (value: number, digits = 0) =>
  value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Stable scene IDs are optional work-local authoring aids, not a Runner scene schema.
export const scenePlan = [
  { id: "price", start: 0, label: "价格" },
  { id: "attendance", start: 6, label: "出勤" },
  { id: "average", start: 16, label: "均价" },
  { id: "comparison", start: 28, label: "临界点" },
  { id: "scenarios", start: 40, label: "情景" },
  { id: "decision", start: 51, label: "结论" },
] as const;
export function timeline(duration: number, fps: number) {
  const starts = scenePlan.map((scene) => Math.round((scene.start / 60) * duration));
  const lengths = starts.map((start, i) => (starts[i + 1] ?? duration) - start);
  const overlap = Math.max(
    0,
    Math.min(Math.round(fps * 0.6), Math.floor(Math.min(...lengths) / 3)),
  );
  return scenePlan.map((scene, i) => ({
    ...scene,
    from: starts[i],
    overlap: i === scenePlan.length - 1 ? 0 : overlap,
    duration: lengths[i] + (i === scenePlan.length - 1 ? 0 : overlap),
  }));
}
