import { useEffect, useState } from "react";
import { cachedMarkdownFacts, emptyMarkdownFacts } from "../notes/markdownAnalysis";
import { analyzeMarkdownAsync } from "../notes/markdownAnalysisClient";

export function useMarkdownFacts(source: string) {
  const [snapshot, setSnapshot] = useState(() => ({
    source,
    facts: cachedMarkdownFacts(source) ?? emptyMarkdownFacts,
  }));
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void analyzeMarkdownAsync(source, controller.signal).then(
        (facts) => {
          if (!controller.signal.aborted) setSnapshot({ source, facts });
        },
        () => {},
      );
    }, 90);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [source]);
  const cached = cachedMarkdownFacts(source);
  return cached ? { source, facts: cached } : snapshot;
}
