import { MANGA_COMPUTE as backends } from "./execution/operations";
import { definition } from "./app-definition";
import { BookOpenText } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Manga Studio — comic OCR, translation, cleaning and CJK typesetting.
 *
 * Contributes the largest handler set to the host compute worker: OCR, model
 * preload, translation and clean preview.
 */
/** Operations this app contributes to the host compute worker. */
const MANGA_COMPUTE = { backends } as const;

export const manifest = {
  ...definition,
  icon: BookOpenText,
  load: () => import("./App"),
  validateSearch: (search) => ({
    document: typeof search["document"] === "string" ? search["document"] : undefined,
    page: typeof search["page"] === "string" ? search["page"] : undefined,
    region: typeof search["region"] === "string" ? search["region"] : undefined,
  }),
  compute: MANGA_COMPUTE,
} as const satisfies AppManifest;
