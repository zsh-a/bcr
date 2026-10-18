import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "@bcr/storage-opfs";
import { createKnowledgeGitHub } from "../../../scripts/fixtures/knowledge-github.mjs";
import { KnowledgeStore } from "../src/knowledge/session/store";
import { newNote, pendingCount } from "../src/knowledge/session/model";
import { attachmentPath } from "../src/knowledge/attachments/attachmentModel";
import { GitHubKnowledge } from "../src/knowledge/sync/github";
import { syncKnowledge } from "../src/knowledge/sync/sync";
import { noteMarkdown } from "../src/knowledge/storage/files";

const target = { owner: "alice", repo: "notes", branch: "main" };
const stores: KnowledgeStore[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(stores.splice(0).map((store) => store.close()));
});

function device() {
  const records = new Map<string, string>(),
    binary = new MemoryStore();
  const store = new KnowledgeStore(
    {
      get: async (key) => records.get(key),
      set: async (key, value) => {
        records.set(key, value);
      },
      batch: async (writes) => {
        for (const [key, value] of writes)
          if (value === undefined) records.delete(key);
          else records.set(key, value);
      },
    },
    binary,
  );
  stores.push(store);
  return { store, binary };
}

async function seeded() {
  const local = device(),
    fixture = createKnowledgeGitHub();
  await local.store.configure(target);
  const asset = await local.store.importAttachment(
    new File(["verified attachment bytes"], "memo.txt", { type: "text/plain" }),
  );
  const note = { ...newNote("笔记"), id: "note-one", body: `[附件](attachment:${asset.id})` };
  await local.store.saveNote(note, null);
  const remote = new GitHubKnowledge(target, "fixture-token", fixture.fetch as typeof fetch);
  await syncKnowledge(local.store, remote);
  // The first upload creates a new HEAD. Verify that committed snapshot once.
  await syncKnowledge(local.store, remote);
  fixture.state.requests.length = 0;
  return { ...local, fixture, remote, asset, note };
}

const background = { background: true };

describe("knowledge background sync cache", () => {
  it("checks privacy and HEAD but skips trees and attachment hashes for a warm unchanged snapshot", async () => {
    const { store, fixture, remote } = await seeded();
    const verify = vi.spyOn(store.attachments, "verify");
    const result = await remote.read(store.getSnapshot().sync.base, background);
    const again = await remote.read(store.getSnapshot().sync.base, background);
    expect(again).toBe(result);
    expect(verify).not.toHaveBeenCalled();
    expect(fixture.state.requests.map(({ path }) => path)).toEqual([
      "",
      "/git/ref/heads/main",
      "",
      "/git/ref/heads/main",
    ]);
  });

  it("uploads local edits against the cached HEAD without discarding them", async () => {
    const { store, remote, fixture, note } = await seeded();
    const verify = vi.spyOn(store.attachments, "verify");
    const base = store.getSnapshot().notes[note.id]!;
    await store.saveNote(
      { ...base, body: `${base.body}\n\n本机新内容`, updatedAt: Date.now() },
      base,
    );
    const complete = vi.fn();
    await syncKnowledge(store, remote, undefined, { onComplete: complete }, background);
    expect(verify).not.toHaveBeenCalled();
    expect(fixture.files()[`knowledge/notes/${note.id}.md`]).toContain("本机新内容");
    expect(pendingCount(store.getSnapshot())).toBe(0);
    expect(complete).toHaveBeenCalledWith({ uploaded: 1, downloaded: 0 });
  });

  it("leaves the durable snapshot untouched for a quiet background poll", async () => {
    const { store, remote, fixture } = await seeded();
    const snapshot = store.getSnapshot();
    const integrate = vi.spyOn(store, "integrate"),
      prepare = vi.spyOn(remote, "prepare"),
      complete = vi.fn();
    await syncKnowledge(store, remote, undefined, { onComplete: complete }, background);
    expect(store.getSnapshot()).toBe(snapshot);
    expect(integrate).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith({ uploaded: 0, downloaded: 0 });
    expect(fixture.state.requests.map(({ path }) => path)).toEqual(["", "/git/ref/heads/main"]);
  });

  it("keeps edits saved while an unchanged HEAD check is in flight pending for the next poll", async () => {
    const { store, remote, fixture, note } = await seeded();
    const head = fixture.state.head,
      read = remote.read.bind(remote);
    vi.spyOn(remote, "read").mockImplementationOnce(async (base, options) => {
      const result = await read(base, options);
      const current = store.getSnapshot().notes[note.id]!;
      await store.saveNote({ ...current, body: `${current.body}\n并发编辑` }, current);
      return result;
    });
    await syncKnowledge(store, remote, undefined, {}, background);
    expect(store.getSnapshot().notes[note.id]?.body).toContain("并发编辑");
    expect(pendingCount(store.getSnapshot())).toBe(1);
    expect(fixture.state.head).toBe(head);
    await syncKnowledge(store, remote, undefined, {}, background);
    expect(pendingCount(store.getSnapshot())).toBe(0);
    expect(fixture.files()[`knowledge/notes/${note.id}.md`]).toContain("并发编辑");
  });

  it("does a full read when HEAD changes and receives remote note changes", async () => {
    const { store, remote, fixture, note } = await seeded();
    const verify = vi.spyOn(store.attachments, "verify");
    const base = store.getSnapshot().notes[note.id]!;
    fixture.advance({
      [`knowledge/notes/${note.id}.md`]: noteMarkdown({ ...base, body: "来自另一台设备" }),
    });
    await syncKnowledge(store, remote, undefined, {}, background);
    expect(verify).toHaveBeenCalled();
    expect(store.getSnapshot().notes[note.id]?.body).toBe("来自另一台设备");
    expect(fixture.state.requests.some(({ path }) => path.startsWith("/git/trees/"))).toBe(true);
  });

  it("keeps manual checks complete and repairs a missing local attachment", async () => {
    const { store, binary, asset, remote, fixture } = await seeded();
    await binary.delete(`artifacts/${attachmentPath(asset.hash)}`);
    await syncKnowledge(store, remote);
    expect(await store.attachments.verify(asset)).toBeDefined();
    expect(fixture.state.requests.some(({ path }) => path.startsWith("/git/blobs/"))).toBe(true);
  });

  it("detects same-size local corruption on a manual check even when the HEAD cache is warm", async () => {
    const { store, binary, asset, remote, note } = await seeded();
    await binary.put(`artifacts/${attachmentPath(asset.hash)}`, new Uint8Array(asset.size));
    await expect(syncKnowledge(store, remote)).rejects.toThrow("附件校验失败");
    expect(store.getSnapshot().notes[note.id]?.body).toBe(note.body);
    expect(store.getSnapshot().sync.pending).toBeNull();
    // A failed complete check cannot fall back to the old warm cache.
    await expect(syncKnowledge(store, remote, undefined, {}, background)).rejects.toThrow(
      "附件校验失败",
    );
  });

  it("expires integrity checks after five minutes without extending their age on cache hits", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    const { store, binary, asset, remote, fixture } = await seeded();
    const verify = vi.spyOn(store.attachments, "verify");
    now.mockReturnValue(start + 4 * 60_000);
    await remote.read(store.getSnapshot().sync.base, background);
    expect(verify).not.toHaveBeenCalled();
    await binary.put(`artifacts/${attachmentPath(asset.hash)}`, new Uint8Array(asset.size));
    now.mockReturnValue(start + 5 * 60_000);
    await expect(remote.read(store.getSnapshot().sync.base, background)).rejects.toThrow(
      "附件校验失败",
    );
    expect(verify).toHaveBeenCalledOnce();
    expect(fixture.state.requests.some(({ path }) => path.startsWith("/git/trees/"))).toBe(true);
  });

  it("invalidates the verified snapshot when another device supplies its attachment storage", async () => {
    const { remote, asset, fixture } = await seeded();
    const other = device();
    await other.store.configure(target);
    await syncKnowledge(other.store, remote, undefined, {}, background);
    expect(await other.store.attachments.verify(asset)).toBeDefined();
    expect(fixture.state.requests.some(({ path }) => path.startsWith("/git/blobs/"))).toBe(true);
  });

  it("never reuses a cache after the repository becomes public", async () => {
    const { store, remote, fixture } = await seeded();
    fixture.state.private = false;
    await expect(syncKnowledge(store, remote, undefined, {}, background)).rejects.toThrow(
      "请使用私有仓库",
    );
    expect(fixture.state.requests.map(({ path }) => path)).toEqual([""]);
  });

  it("reconciles a lost publication acknowledgement before uploading another background edit", async () => {
    const { store, remote, fixture, note } = await seeded();
    const first = store.getSnapshot().notes[note.id]!;
    await store.saveNote({ ...first, body: `${first.body}\nfirst edit` }, first);
    fixture.state.loseNextAck = true;
    await expect(syncKnowledge(store, remote, undefined, {}, background)).rejects.toThrow(
      "无法连接 GitHub",
    );
    expect(store.getSnapshot().sync.pending).not.toBeNull();
    const second = store.getSnapshot().notes[note.id]!;
    await store.saveNote({ ...second, body: `${second.body}\nsecond edit` }, second);
    await syncKnowledge(store, remote, undefined, {}, background);
    expect(fixture.files()[`knowledge/notes/${note.id}.md`]).toContain("first edit\nsecond edit");
    expect(store.getSnapshot().sync.pending).toBeNull();
    expect(pendingCount(store.getSnapshot())).toBe(0);
  });
});
