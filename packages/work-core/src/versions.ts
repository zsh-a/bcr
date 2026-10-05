import { Schema } from "effect";

const id = Schema.String.pipe(Schema.pattern(/^[a-zA-Z0-9_-]{1,100}$/u));
export const VersionListSchema = Schema.Struct({
  id,
  cursor: Schema.optional(id),
});
export const CheckpointSchema = Schema.Struct({
  id,
  revision: id,
  requestId: id,
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(160)),
});
export const RestoreSchema = Schema.Struct({
  id,
  revision: id,
  restoreRevision: id,
  requestId: id,
});
export const DiffSchema = Schema.Struct({
  id,
  from: id,
  to: id,
  path: Schema.optional(Schema.String.pipe(Schema.maxLength(240))),
});
export type CheckpointRequest = typeof CheckpointSchema.Type;
export type RestoreRequest = typeof RestoreSchema.Type;
export type VersionEntry = {
  id: string;
  revision: string;
  parent: string | null;
  message: string;
  kind: "save" | "checkpoint" | "restore" | "snapshot";
  createdAt: number;
  restoredFrom?: string;
};
export type VersionPage = {
  head: string;
  items: VersionEntry[];
  nextCursor: string | null;
  pending?: RestoreRequest;
};
export type VersionFile = { path: string; hash: string; size: number };
export type FileChange = {
  path: string;
  status: "added" | "modified" | "removed";
  before?: VersionFile;
  after?: VersionFile;
};
export type VersionDiff = {
  from: string;
  to: string;
  changes: FileChange[];
  detail?: { path: string; before: string | null; after: string | null; message?: string };
};
/** Hashes stay within their source; browser BLAKE3 is never compared to Runner SHA-256. */
export function changedFiles(
  before: readonly VersionFile[],
  after: readonly VersionFile[],
): FileChange[] {
  const old = new Map(before.map((f) => [f.path, f])),
    next = new Map(after.map((f) => [f.path, f]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((path) => {
    const a = old.get(path),
      b = next.get(path);
    return a?.hash === b?.hash
      ? []
      : [
          {
            path,
            status: !a ? ("added" as const) : !b ? ("removed" as const) : ("modified" as const),
            ...(a ? { before: a } : {}),
            ...(b ? { after: b } : {}),
          },
        ];
  });
}
export function textChange(before: string | null, after: string | null) {
  const a = (before ?? "").split("\n"),
    b = (after ?? "").split("\n");
  let prefix = 0,
    suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  while (
    suffix < Math.min(a.length, b.length) - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  )
    suffix++;
  return { before: a, after: b, prefix, suffix };
}
