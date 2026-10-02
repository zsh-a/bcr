import { manifest as data } from "@bcr/data-studio/app-manifest";
import { manifest as documents } from "@bcr/document-studio/app-manifest";
import { manifest as manga } from "@bcr/manga-studio/app-manifest";
import { manifest as media } from "@bcr/media-studio/app-manifest";

/** Tuple spreads retain literal operation types without maintaining a parallel routing list. */
export const COMPUTE_OPERATIONS = {
  wasm: [
    ...media.compute.backends.wasm,
    ...documents.compute.backends.wasm,
    ...manga.compute.backends.wasm,
    ...data.compute.backends.wasm,
  ],
  js: [
    ...media.compute.backends.js,
    ...documents.compute.backends.js,
    ...manga.compute.backends.js,
    ...data.compute.backends.js,
  ],
} as const;
export type StudioBackend = keyof typeof COMPUTE_OPERATIONS;
export type StudioOperation = (typeof COMPUTE_OPERATIONS)[StudioBackend][number];
