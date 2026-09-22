import { describe, expect, it } from "vitest";
import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import {
  planKnowledgeRestore,
  readKnowledgeBackup,
  writeKnowledgeBackup,
} from "../src/knowledge/backup";
import { contentOf, newNote } from "../src/knowledge/model";
import { KnowledgeStore } from "../src/knowledge/store";

const note = { ...newNote("Backup"), id: "note", body: "original", collectionId: "collection" };
const original = {
  notes: { note },
  collections: { collection: { id: "collection", name: "Collection" } },
};

describe("portable knowledge backup", () => {
  it("roundtrips notes, identities and collections", async () => {
    expect(await readKnowledgeBackup(await writeKnowledgeBackup(original))).toEqual(original);
  });
  it("rejects unknown and unsafe archive paths", async () => {
    for (const path of ["knowledge/../secret.md", "unknown.txt"]) {
      const zip = new ZipWriter(new BlobWriter(), { useWebWorkers: false });
      await zip.add(path, new TextReader("bad"));
      await expect(readKnowledgeBackup(await zip.close())).rejects.toThrow();
    }
  });
  it("plans skip, replace and keep-both without mutating the source", () => {
    const incoming = { ...original, notes: { note: { ...note, body: "backup" } } };
    expect(planKnowledgeRestore(original, incoming, "skip").content.notes.note?.body).toBe(
      "original",
    );
    expect(planKnowledgeRestore(original, incoming, "replace").content.notes.note?.body).toBe(
      "backup",
    );
    const both = planKnowledgeRestore(original, incoming, "both");
    expect(both.copied).toBe(1);
    expect(Object.keys(both.content.notes)).toHaveLength(2);
    expect(original.notes.note.body).toBe("original");
  });
  it("does not partially change local state on persistence failure or stale preview", async () => {
    let fail = false;
    let raw: string | undefined;
    const store = new KnowledgeStore({
      get: async () => raw,
      set: async (_key, value) => {
        if (fail) throw new Error("disk full");
        raw = value;
      },
    });
    await store.importContent(original);
    const base = contentOf(store.getSnapshot());
    const incoming = { ...original, notes: { note: { ...note, body: "backup" } } };
    fail = true;
    await expect(store.restoreBackup(incoming, base)).rejects.toThrow("disk full");
    expect(store.getSnapshot().notes.note?.body).toBe("original");
    fail = false;
    await store.saveNote({ ...note, body: "new edit" }, note);
    await expect(store.restoreBackup(incoming, base)).rejects.toThrow("预览后知识库已变化");
    const fresh = contentOf(store.getSnapshot());
    await store.restoreBackup(incoming, fresh);
    expect(store.getSnapshot().notes.note?.body).toBe("backup");
    expect(store.getSnapshot().history[0]?.note.body).toBe("new edit");
  });
});
