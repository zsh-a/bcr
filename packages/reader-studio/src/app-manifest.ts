import { LibraryBig } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Reader Studio — multi-format local reading with search and progress restore.
 *
 * Its runtime composition and persistence facade stay in the package; the shell
 * only needs the route and the entry component.
 */
export const manifest: AppManifest = {
  id: "reader",
  title: "Reader Studio",
  path: "/reader",
  icon: LibraryBig,
  description: "本地阅读空间 · TXT / Markdown / HTML / DOCX / EPUB / PDF / CBZ · 进度与全文搜索",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    cite: search["cite"],
    document: typeof search["document"] === "string" ? search["document"] : undefined,
    book: typeof search["book"] === "string" ? search["book"] : undefined,
    section: typeof search["section"] === "string" ? search["section"] : undefined,
    start: typeof search["start"] === "number" ? search["start"] : undefined,
    end: typeof search["end"] === "number" ? search["end"] : undefined,
    quote: typeof search["quote"] === "string" ? search["quote"] : undefined,
  }),
};
