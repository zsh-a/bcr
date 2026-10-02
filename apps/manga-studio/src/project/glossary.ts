import type { MangaGlossaryEntry } from "./model";

function normalized(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

/** Return enabled, non-empty entries in longest-first order for stable matching. */
export function activeGlossaryEntries(
  entries: ReadonlyArray<MangaGlossaryEntry>,
): ReadonlyArray<MangaGlossaryEntry> {
  return entries
    .filter(
      (entry) =>
        entry.enabled && normalized(entry.source).length > 0 && normalized(entry.target).length > 0,
    )
    .slice()
    .sort((left, right) => {
      const length = normalized(right.source).length - normalized(left.source).length;
      return length !== 0 ? length : left.id.localeCompare(right.id);
    });
}

/** Find source terms present in a region without mutating OCR text. */
export function findGlossaryMatches(
  text: string,
  entries: ReadonlyArray<MangaGlossaryEntry>,
): ReadonlyArray<MangaGlossaryEntry> {
  const source = normalized(text);
  if (source.length === 0) return [];
  const active = activeGlossaryEntries(entries);
  return active.filter((entry) => {
    const term = normalized(entry.source);
    if (!source.includes(term)) return false;
    // Prefer a more specific phrase when entries overlap (e.g. 勇者 over 勇).
    return !active.some((other) => {
      const otherTerm = normalized(other.source);
      return (
        other.id !== entry.id &&
        otherTerm.length > term.length &&
        otherTerm.includes(term) &&
        source.includes(otherTerm)
      );
    });
  });
}

function replaceTerms(text: string, entries: ReadonlyArray<MangaGlossaryEntry>): string {
  const active = activeGlossaryEntries(entries);
  if (active.length === 0) return text;
  const bySource = new Map(active.map((entry) => [normalized(entry.source), entry]));
  const pattern = active
    .map((entry) => normalized(entry.source).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("|");
  return text.replace(new RegExp(pattern, "gu"), (match) => bySource.get(match)?.target ?? match);
}

/** Apply glossary replacements to an already translated string without recursive rewrites. */
export function applyGlossaryTerms(
  text: string,
  entries: ReadonlyArray<MangaGlossaryEntry>,
): string {
  return replaceTerms(text, entries);
}

/**
 * Deterministic fixture translation with glossary semantics:
 * exact phrase entries win; fallback text receives longest-first replacements.
 */
export function translateWithGlossary(
  text: string,
  entries: ReadonlyArray<MangaGlossaryEntry>,
  baseTranslate: (text: string) => string,
): string {
  const source = normalized(text);
  const active = activeGlossaryEntries(entries);
  const exact = active.find((entry) => normalized(entry.source) === source);
  if (exact !== undefined) return normalized(exact.target);
  const translated = baseTranslate(source);
  return replaceTerms(translated, active.length > 0 ? active : []);
}
