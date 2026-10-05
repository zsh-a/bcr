import { Schema } from "effect";

const text = (max: number) => Schema.String.pipe(Schema.maxLength(max));
const id = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,100}$/u));
const pixel = Schema.Number.pipe(Schema.between(0, 1_000_000));
export const PageViewportSchema = Schema.Struct({
  width: Schema.Number.pipe(Schema.int(), Schema.between(240, 2560)),
  height: Schema.Number.pipe(Schema.int(), Schema.between(240, 2160)),
});
export const PageElementSchema = Schema.Struct({
  selector: text(1000),
  text: text(300),
  x: Schema.Number,
  y: Schema.Number,
  width: pixel,
  height: pixel,
});
export const PageStateSchema = Schema.Struct({
  path: text(240),
  viewport: PageViewportSchema,
  hash: Schema.optional(text(1000)),
  scroll: Schema.optional(Schema.Struct({ x: pixel, y: pixel })),
  controls: Schema.optional(
    Schema.Array(
      Schema.Struct({
        selector: text(1000),
        value: Schema.optional(text(4000)),
        checked: Schema.optional(Schema.Boolean),
      }),
    ).pipe(Schema.maxItems(100)),
  ),
  details: Schema.optional(
    Schema.Array(Schema.Struct({ selector: text(1000), open: Schema.Boolean })).pipe(
      Schema.maxItems(100),
    ),
  ),
  custom: Schema.optional(text(64000)),
});
export const ReviewImageSchema = Schema.Struct({
  hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/u)),
  hashAlgorithm: Schema.Literal("sha256", "blake3"),
  name: text(100),
  mime: Schema.Literal("image/png"),
  size: Schema.Number.pipe(Schema.int(), Schema.between(1, 20 * 1024 * 1024)),
  captureId: Schema.optional(id),
});
export const ReviewViewSchema = Schema.Struct({
  id,
  submissionId: id,
  title: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160)),
  page: PageStateSchema,
  image: ReviewImageSchema,
  elements: Schema.Array(PageElementSchema).pipe(Schema.maxItems(200)),
  warnings: Schema.Array(text(1000)).pipe(Schema.maxItems(20)),
  engine: text(200),
  createdAt: Schema.Number,
});
export type PageState = typeof PageStateSchema.Type;
export type PageViewport = typeof PageViewportSchema.Type;
export type PageElement = typeof PageElementSchema.Type;
export type ReviewImage = typeof ReviewImageSchema.Type;
export type ReviewView = typeof ReviewViewSchema.Type;
export const PageCaptureSchema = Schema.Struct({
  requestId: id,
  source: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("submission"), id, submissionId: id }),
    Schema.Struct({
      kind: Schema.Literal("document"),
      key: text(300),
      html: text(14 * 1024 * 1024),
    }),
  ),
  page: PageStateSchema,
});
export type PageCaptureRequest = typeof PageCaptureSchema.Type;
export type PageCapture = {
  id: string;
  source: { kind: "submission" | "document"; key: string; submissionId?: string; workId?: string };
  page: PageState;
  image: ReviewImage;
  elements: PageElement[];
  warnings: string[];
  engine: string;
  createdAt: number;
};
