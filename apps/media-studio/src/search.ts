import { mediaDocuments } from "./mediaSearchDocuments";
import { useRuntime } from "@bcr/react";
import { useEffect } from "react";
import { useStudio } from "./store";

export function useMediaSearch(): void {
  const { search } = useRuntime();
  const source = useStudio((state) => state.source);
  const engine = useStudio((state) => state.engineUsed);
  const cues = useStudio((state) => state.cues);
  useEffect(() => {
    search?.replaceSource("media", mediaDocuments(source, cues, engine));
  }, [search, source, cues, engine]);
}
