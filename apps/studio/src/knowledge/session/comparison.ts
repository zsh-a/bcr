/** General comparisons may receive mutable form values; only identity is assumed here. */
export const same = (a: unknown, b: unknown): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

const comparisons = new WeakMap<object, WeakMap<object, boolean>>();

/** Only for immutable validated domain records. Weak pair keys retain no serialized bodies. */
export function sameRecord(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return same(a, b);
  let matches = comparisons.get(a);
  if (matches?.has(b)) return matches.get(b)!;
  const result = same(a, b);
  if (!matches) comparisons.set(a, (matches = new WeakMap()));
  matches.set(b, result);
  return result;
}
