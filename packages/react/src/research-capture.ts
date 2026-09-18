import { createContext, createElement, useContext, type ReactNode } from "react";
import type { SearchDocument, TextCitation } from "@bcr/core";

export interface ResearchCapture {
  readonly document: SearchDocument;
  readonly citation: TextCitation;
  readonly note: string;
}

/** Host-owned collections; domain apps contribute a source snapshot only. */
export interface ResearchCaptureService {
  readonly ready: boolean;
  readonly error: string | null;
  readonly collections: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly save: (
    collection: { readonly id: string; readonly name?: string },
    capture: ResearchCapture,
  ) => Promise<"saved" | "duplicate">;
}

const Context = createContext<ResearchCaptureService | null>(null);
export function ResearchCaptureProvider(props: {
  service: ResearchCaptureService;
  children: ReactNode;
}) {
  return createElement(Context.Provider, { value: props.service }, props.children);
}
export function useResearchCapture(): ResearchCaptureService | null {
  return useContext(Context);
}
