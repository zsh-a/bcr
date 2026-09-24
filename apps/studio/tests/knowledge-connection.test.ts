import { describe, expect, it, vi } from "vitest";
import { createKnowledgeGitHub } from "../../../scripts/fixtures/knowledge-github.mjs";
import { parseRepository } from "../src/knowledge/repository";
import { GitHubKnowledge } from "../src/knowledge/github";
import { KnowledgeStore } from "../src/knowledge/store";
import { emptyContent } from "../src/knowledge/model";

describe("simplified GitHub connection", () => {
  it.each(["Alice/Notes", "https://github.com/Alice/Notes", "https://github.com/Alice/Notes.git/"])(
    "accepts repository identity %s",
    (address) => {
      expect(parseRepository(address)).toEqual({ owner: "alice", repo: "notes" });
    },
  );
  it.each([
    "https://evil.test/alice/notes",
    "http://github.com/alice/notes",
    "https://github.com@evil.test/alice/notes",
    "https://secret@github.com/alice/notes",
    "https://github.com/alice/notes?token=secret",
    "https://github.com/alice/notes#main",
    "https://github.com:443/alice/notes",
    "alice/../notes",
    "alice/..",
    "alice/notes/tree/main",
    "alice/%2e%2e",
    "alice/.git",
    "",
  ])("rejects unsafe or ambiguous address %s before any request", async (address) => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(GitHubKnowledge.connect(address, "test-token", "", fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("discovers the default branch and performs only read requests", async () => {
    const fixture = createKnowledgeGitHub();
    fixture.state.defaultBranch = "trunk";
    const remote = await GitHubKnowledge.connect(
      "alice/notes",
      "test-token",
      "",
      fixture.fetch as typeof fetch,
    );
    expect(remote.target.branch).toBe("trunk");
    expect(fixture.state.requests.some((r) => r.path === "/git/ref/heads/trunk")).toBe(true);
    expect(fixture.state.requests.every((r) => r.method === "GET")).toBe(true);
  });
  it("supports an explicit existing branch", async () => {
    const fixture = createKnowledgeGitHub();
    const remote = await GitHubKnowledge.connect(
      "alice/notes",
      "test-token",
      "notes/sync",
      fixture.fetch as typeof fetch,
    );
    expect(remote.target.branch).toBe("notes/sync");
  });
  it("rejects public repositories without uploading", async () => {
    const fixture = createKnowledgeGitHub();
    fixture.state.private = false;
    await expect(
      GitHubKnowledge.connect("alice/notes", "test-token", "", fixture.fetch as typeof fetch),
    ).rejects.toThrow("私有仓库");
    expect(fixture.state.requests).toHaveLength(1);
  });
  it.each(["archived", "disabled"])("rejects %s repositories", async (field) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ private: true, [field]: true })));
    await expect(GitHubKnowledge.connect("alice/notes", "test-token", "", fetcher)).rejects.toThrow(
      "归档或停用",
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retains the current connection and receipt until a pending publish is reconciled", async () => {
    const store = new KnowledgeStore({ get: async () => undefined, set: async () => {} });
    await store.ready;
    const target = { owner: "alice", repo: "notes", branch: "main" };
    await store.configure(target);
    await store.recordPending("a".repeat(40), emptyContent());
    await expect(store.configure(null)).rejects.toThrow("核对上次提交");
    await expect(store.configure({ ...target, branch: "other" })).rejects.toThrow("核对上次提交");
    await store.configure(target);
    expect(store.getSnapshot().sync.target).toEqual(target);
    expect(store.getSnapshot().sync.pending).not.toBeNull();
  });
});
