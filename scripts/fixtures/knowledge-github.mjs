import { createHash } from "node:crypto";

// A small Git object database, shared by unit and isolated multi-device browser tests.
// Ref updates enforce ancestry; trees preserve files outside the managed namespace.
export function createKnowledgeGitHub() {
  const blobs = new Map(),
    trees = new Map(),
    commits = new Map(),
    requests = [];
  let serial = 0;
  const id = () => createHash("sha1").update(`fixture-${++serial}`).digest("hex");
  const blobId = (text) =>
    createHash("sha1")
      .update(`blob ${Buffer.byteLength(text)}\0`)
      .update(text)
      .digest("hex");
  function tree(files) {
    const sha = id();
    trees.set(sha, { ...files });
    return sha;
  }
  function commit(files, parent = null) {
    const sha = id();
    commits.set(sha, { tree: tree(files), parent });
    return sha;
  }
  const initial = commit({
    "README.md": "Private personal repository\n",
    "other/keep.txt": "untouched",
  });
  const state = {
    head: initial,
    private: true,
    truncated: false,
    mode: "100644",
    loseNextAck: false,
    /** Optional one-shot hook run before a publish; tests install it to force races. */
    beforePublish: /** @type {null | (() => unknown)} */ (null),
    requests,
  };
  function ancestor(base, head) {
    for (let current = head; current; current = commits.get(current)?.parent)
      if (current === base) return true;
    return false;
  }
  function files(head = state.head) {
    return { ...trees.get(commits.get(head)?.tree) };
  }
  function advance(changes) {
    const next = files();
    for (const [path, text] of Object.entries(changes)) {
      if (text === null) delete next[path];
      else next[path] = text;
    }
    state.head = commit(next, state.head);
    return state.head;
  }
  async function handle(url, method = "GET", body) {
    const request = new URL(url),
      path = decodeURIComponent(request.pathname.replace(/^\/repos\/[^/]+\/[^/]+/u, ""));
    requests.push({ method, path, body });
    const ok = (json) => ({ status: 200, json });
    if (!path) return ok({ private: state.private });
    if (path.startsWith("/git/ref/heads/")) return ok({ object: { sha: state.head } });
    if (path.startsWith("/git/refs/heads/") && method === "PATCH") {
      if (state.beforePublish) {
        const hook = state.beforePublish;
        state.beforePublish = null;
        await hook();
      }
      if (body.force !== false || !ancestor(state.head, body.sha)) return { status: 422, json: {} };
      state.head = body.sha;
      if (state.loseNextAck) {
        state.loseNextAck = false;
        throw new TypeError("response lost after successful publish");
      }
      return ok({ object: { sha: state.head } });
    }
    if (path === "/git/trees" && method === "POST") {
      const next = { ...trees.get(body.base_tree) };
      for (const change of body.tree) {
        if (change.sha === null) delete next[change.path];
        else next[change.path] = change.content;
      }
      return ok({ sha: tree(next) });
    }
    if (path === "/git/commits" && method === "POST") {
      const sha = id();
      commits.set(sha, { tree: body.tree, parent: body.parents[0] });
      return ok({ sha });
    }
    if (path.startsWith("/git/commits/")) {
      const value = commits.get(path.split("/").at(-1));
      return value ? ok({ tree: { sha: value.tree } }) : { status: 404, json: {} };
    }
    if (path.startsWith("/git/trees/")) {
      const value = trees.get(path.split("/").at(-1));
      return ok({
        truncated: state.truncated,
        tree: Object.entries(value).map(([path, text]) => {
          const sha = blobId(text);
          blobs.set(sha, text);
          return {
            path,
            sha,
            type: "blob",
            mode: path.startsWith("knowledge/") ? state.mode : "100644",
            size: Buffer.byteLength(text),
          };
        }),
      });
    }
    if (path.startsWith("/git/blobs/")) {
      const text = blobs.get(path.split("/").at(-1));
      return text === undefined
        ? { status: 404, json: {} }
        : ok({
            encoding: "base64",
            size: Buffer.byteLength(text),
            content: Buffer.from(text).toString("base64"),
          });
    }
    if (path.startsWith("/compare/")) {
      const [base, head] = path.slice(9).split("...");
      return ok({
        status:
          base === head
            ? "identical"
            : ancestor(base, head)
              ? "ahead"
              : ancestor(head, base)
                ? "behind"
                : "diverged",
      });
    }
    if (path === "/commits") {
      const result = [],
        notePath = request.searchParams.get("path");
      for (let head = state.head; head && result.length < 20; head = commits.get(head).parent) {
        const parent = commits.get(head).parent;
        if (files(head)[notePath] !== (parent ? files(parent)[notePath] : undefined))
          result.push({
            sha: head,
            commit: {
              message: "BCR: sync personal knowledge",
              author: { date: "2026-09-19T00:00:00Z" },
            },
          });
      }
      return ok(result);
    }
    throw new Error(`Unexpected fixture request: ${method} ${path}`);
  }
  const fetcher = async (url, init = {}) => {
    const result = await handle(url, init.method, init.body ? JSON.parse(init.body) : undefined);
    return new Response(JSON.stringify(result.json), {
      status: result.status,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { state, initial, files, advance, handle, fetch: fetcher };
}
