import { useEffect, useMemo, useState } from "react";
import type { KnowledgeNote } from "../session/model";
import { createNoteResolver, type NoteAnalysis } from "../notes/markdownAnalysis";
import { analyzeMarkdownAsync } from "../notes/markdownAnalysisClient";

/** Relationship indexing must not parse every saved/cold note on the UI thread. */
export function useKnowledgeBacklinks(records: Record<string, KnowledgeNote>, id?: string) {
  const [cache] = useState(() => new Map<string, { body: string; analysis: NoteAnalysis }>());
  const [revision, setRevision] = useState(0);
  const notes = useMemo(() => Object.values(records), [records]);
  useEffect(() => {
    const controller = new AbortController();
    const ids = new Set(notes.map((note) => note.id));
    for (const key of cache.keys()) if (!ids.has(key)) cache.delete(key);
    let frame = 0;
    for (const note of notes) {
      if (cache.get(note.id)?.body === note.body) continue;
      void analyzeMarkdownAsync(note.body, controller.signal, true).then(
        (facts) => {
          if (controller.signal.aborted) return;
          cache.set(note.id, { body: note.body, analysis: facts.analysis });
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0;
              setRevision((n) => n + 1);
            });
        },
        () => {},
      );
    }
    return () => {
      controller.abort();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [notes, cache]);
  return useMemo(() => {
    const resolve = createNoteResolver(notes);
    return notes.filter(
      (note) =>
        note.id !== id &&
        cache.get(note.id)?.body === note.body &&
        cache.get(note.id)?.analysis.links.some((link) => {
          const matches = resolve(link.target, note.id);
          return matches.length === 1 && matches[0]!.id === id;
        }),
    );
  }, [notes, id, cache, revision]);
}
