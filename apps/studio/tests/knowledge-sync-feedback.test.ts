import { expect, it } from "vitest";
import { createKnowledgeGitHub } from "../../../scripts/fixtures/knowledge-github.mjs";
import { KnowledgeStore } from "../src/knowledge/session/store";
import { newNote } from "../src/knowledge/session/model";
import { GitHubKnowledge } from "../src/knowledge/sync/github";
import { syncKnowledge, type SyncSummary } from "../src/knowledge/sync/sync";

it("reports received changes even when another note requires conflict resolution", async () => {
  const device = () => {
    const data = new Map<string, string>();
    return new KnowledgeStore({
      get: async (key) => data.get(key),
      set: async (key, value) => {
        data.set(key, value);
      },
    });
  };
  const local = device(),
    other = device();
  const fixture = createKnowledgeGitHub();
  const target = { owner: "alice", repo: "notes", branch: "main" };
  const api = new GitHubKnowledge(target, "fixture-token", fixture.fetch as typeof fetch);
  await local.configure(target);
  await other.configure(target);
  for (const id of ["conflicting", "remote-only"])
    await local.saveNote({ ...newNote(id), id, body: "共同正文" }, null);
  await syncKnowledge(local, api);
  await syncKnowledge(other, api);
  const first = local.getSnapshot().notes.conflicting!;
  await local.saveNote({ ...first, body: "本机重写同一行" }, first);
  for (const id of ["conflicting", "remote-only"]) {
    const base = other.getSnapshot().notes[id]!;
    await other.saveNote({ ...base, body: "远端重写同一行" }, base);
  }
  await syncKnowledge(other, api);
  let summary: SyncSummary | null = null;
  expect(
    await syncKnowledge(local, api, undefined, {
      onComplete: (value) => {
        summary = value;
      },
    }),
  ).toBe("conflicts");
  expect(local.getSnapshot().conflicts).toHaveLength(1);
  expect(local.getSnapshot().notes.conflicting!.body).toBe("本机重写同一行");
  expect(local.getSnapshot().notes["remote-only"]!.body).toBe("远端重写同一行");
  expect(summary).toEqual({ uploaded: 0, downloaded: 1 });
  await local.close();
  await other.close();
});
