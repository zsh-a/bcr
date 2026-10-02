import { artifactPath } from "@bcr/core";
import { FIXTURE_PAGE_URL } from "./fixture";
import type { PersistedSource } from "./persistence";
import type { MangaSource } from "./model";
import { hashReadableStream, type ArtifactRef, type ArtifactStore } from "@bcr/core";
import { MemoryStore } from "@bcr/storage-opfs";
import { Effect } from "effect";
import { manga } from "./store";
import { type MangaStorageContext } from "./context";

/** Stream a user file into the same Artifact namespace used by future OCR tasks. */
export async function importImageArtifact(
  runtime: MangaStorageContext,
  file: File,
  sharedArtifacts?: ArtifactStore,
): Promise<ArtifactRef> {
  const hash = await hashReadableStream(file.stream());
  const storage: ArtifactRef["storage"] = runtime.binary instanceof MemoryStore ? "memory" : "opfs";
  const ref: ArtifactRef = {
    id: `source/${hash}`,
    type: "file/image",
    storage,
    format: file.type || "image/*",
    hash,
  };
  await Effect.runPromise(runtime.artifacts.putStream(ref, file.stream()));
  // Manga owns its project metadata namespace, while the Studio Shell owns
  // the shared Scheduler/WorkerPool namespace. Keep one immutable source ref
  // in both planes so the review OCR task can consume it without coupling the
  // local persistence model to the host shell.
  if (sharedArtifacts !== undefined && sharedArtifacts !== runtime.artifacts) {
    try {
      await Effect.runPromise(sharedArtifacts.putStream(ref, file.stream()));
    } catch (error) {
      manga.log("warn", `artifact bridge · worker source unavailable · ${String(error)}`);
    }
  }
  return ref;
}

export async function restoreSource(
  runtime: MangaStorageContext,
  source: PersistedSource,
): Promise<MangaSource | null> {
  if (source.kind === "fixture") {
    return { ...source, objectUrl: FIXTURE_PAGE_URL };
  }
  if (source.ref === undefined) return null;
  try {
    const blob =
      source.ref.storage === "opfs" && runtime.binary.getBlob !== undefined
        ? await runtime.binary.getBlob(artifactPath(source.ref))
        : undefined;
    const bytes =
      blob === undefined ? await Effect.runPromise(runtime.artifacts.get(source.ref)) : undefined;
    const objectUrl = URL.createObjectURL(
      blob ??
        new Blob([
          (bytes as Uint8Array).buffer.slice(
            (bytes as Uint8Array).byteOffset,
            (bytes as Uint8Array).byteOffset + (bytes as Uint8Array).byteLength,
          ) as BlobPart,
        ]),
    );
    return { ...source, objectUrl, ref: source.ref };
  } catch (error) {
    manga.log("warn", `restore · ${source.name} artifact missing · ${String(error)}`);
    return null;
  }
}
