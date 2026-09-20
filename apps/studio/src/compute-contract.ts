import { manifest as data } from "@bcr/data-studio/app-manifest";
import { manifest as documents } from "@bcr/document-studio/app-manifest";
import { manifest as manga } from "@bcr/manga-studio/app-manifest";
import { manifest as media } from "@bcr/media-studio/app-manifest";

/**
 * Backend routing for the shared compute worker.
 *
 * Listed as literal tuples so the worker's handler table can be checked against
 * it in both directions: `satisfies Record<StudioOperation, …>` rejects an
 * operation with no handler *and* a handler with no route.
 *
 * The list is written out rather than derived from the manifests because
 * deriving it costs the literal types. `MANIFESTS` is a `ReadonlyArray` of the
 * default `AppManifest`, and `flatMap` returns `string[]`, so any derivation
 * widens this union to `string` and makes the worker's check vacuous — a
 * silent loss of the guarantee rather than a compile error.
 *
 * The two sides are kept in sync by {@link ManifestComputeMatchesRoutes}
 * below, which compares the literal manifest tuples against this union and
 * fails the build on any difference.
 */
export const COMPUTE_OPERATIONS = {
  wasm: [
    "hash.blake3",
    "audio.waveform",
    "document.ocr.onnx",
    "manga.ocr.onnx",
    "manga.model.preload",
    "manga.translate.onnx",
  ],
  js: [
    "document.extract",
    "data.parse.table",
    "document.translate.fixture",
    "document.typeset.preview",
    "manga.ocr.review",
    "manga.clean.preview",
  ],
} as const;

export type StudioBackend = keyof typeof COMPUTE_OPERATIONS;

export type StudioOperation = (typeof COMPUTE_OPERATIONS)[StudioBackend][number];

/**
 * Operations the manifests route, read straight off the manifest modules.
 *
 * Importing the manifests directly (not through the registry) preserves their
 * literal tuples, which is what makes the comparison below meaningful.
 */
type RoutedOperation =
  | NonNullable<(typeof media)["compute"]>["backends"]["wasm"][number]
  | NonNullable<(typeof media)["compute"]>["backends"]["js"][number]
  | NonNullable<(typeof manga)["compute"]>["backends"]["wasm"][number]
  | NonNullable<(typeof manga)["compute"]>["backends"]["js"][number]
  | NonNullable<(typeof documents)["compute"]>["backends"]["wasm"][number]
  | NonNullable<(typeof documents)["compute"]>["backends"]["js"][number]
  | NonNullable<(typeof data)["compute"]>["backends"]["wasm"][number]
  | NonNullable<(typeof data)["compute"]>["backends"]["js"][number];

/**
 * Guard: the manifest routes and this table must describe the same operations.
 *
 * A manifest that routes an unhandled operation fails here, and an operation
 * added to `COMPUTE_OPERATIONS` that no manifest declares fails too — the
 * `never` comparisons only hold while both sets are equal.
 */
type MissingRoute = Exclude<RoutedOperation, StudioOperation>;
type MissingHandler = Exclude<StudioOperation, RoutedOperation>;

export const COMPUTE_ROUTES_ARE_RESOLVED: [
  MissingRoute extends never ? true : MissingRoute,
  MissingHandler extends never ? true : MissingHandler,
] = [true, true];
