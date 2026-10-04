import { Schema, JSONSchema } from "effect";
import { Id, Path, Revision, ParamsSchema, RenderSchema, ReviewWriteSchema } from "@bcr/work-core";

const empty = Schema.Record({ key: Schema.String, value: Schema.Never });
const id = Schema.Struct({ id: Id });
const operations = {
  catalog: {
    schema: empty,
    readOnly: true,
    description:
      "Inspect Runner version, protocol, authorized directory and available operations. Start here.",
  },
  list: {
    schema: empty,
    readOnly: true,
    description: "List works and discovery errors in the authorized directory.",
  },
  read: {
    schema: Schema.Struct({ id: Id, revision: Schema.optional(Revision) }),
    readOnly: true,
    description:
      "Inspect work targets, source files, revision and actual source directory. Edit that directory, never the BCR repository.",
  },
  snapshot: {
    schema: Schema.Struct({ id: Id, revision: Revision }),
    readOnly: false,
    description: "Save an immutable work source snapshot for this revision.",
  },
  file: {
    schema: Schema.Struct({
      id: Id,
      revision: Revision,
      path: Path,
      offset: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
    }),
    readOnly: true,
    description:
      "Read up to 32000 text characters from a versioned source file; binary files return metadata.",
  },
  parameters: {
    schema: ParamsSchema,
    readOnly: false,
    description:
      "Update declared parameters using the current source revision and an idempotent requestId. A stale revision is rejected.",
  },
  reviews: {
    schema: id,
    readOnly: true,
    description: "Read timestamped work reviews and their independent revision.",
  },
  review: {
    schema: ReviewWriteSchema,
    readOnly: false,
    description:
      "Create or resolve a review using the reviews revision, a sourceRevision and an idempotent requestId.",
  },
  render: {
    schema: RenderSchema,
    readOnly: false,
    description:
      "Submit validate, preview, capture, video or archive against a fixed source revision. Returns a durable job ID; poll runner_job. Reuse requestId on retries.",
  },
  jobs: {
    schema: Schema.Struct({ id: Schema.optional(Id) }),
    readOnly: true,
    description: "List recent jobs, optionally filtered by work ID.",
  },
  job: {
    schema: id,
    readOnly: true,
    description: "Read job progress, errors and output metadata. This ID is a job ID.",
  },
  cancel: {
    schema: id,
    readOnly: false,
    description: "Explicitly cancel a queued or running job by job ID.",
  },
  preview: {
    schema: id,
    readOnly: true,
    description:
      "Get the isolated preview URL of a succeeded preview job. Does not require a BCR browser.",
  },
} as const;
export type Operation = keyof typeof operations;
export const operationCatalog = Object.entries(operations).map(([name, item]) => ({
  name: name as Operation,
  description: item.description,
  readOnly: item.readOnly,
  schema: JSONSchema.make(item.schema as Schema.Schema<unknown, unknown>),
}));
export function operationInput(name: string, raw: unknown): Record<string, unknown> {
  if (!Object.hasOwn(operations, name)) throw new Error(`未知 Runner 操作：${name}`);
  const schema = operations[name as Operation].schema as Schema.Schema<
    Record<string, unknown>,
    unknown
  >;
  return Schema.decodeUnknownSync(schema, { onExcessProperty: "error" })(raw ?? {});
}
