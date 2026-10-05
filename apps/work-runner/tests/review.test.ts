import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startRunner } from "../src/server";
import { ReviewRepository } from "../src/review";
import {
  editReviewBook,
  emptyReviewBook,
  type ReviewAction,
  type Submission,
} from "@bcr/work-core";

test("submissions, feedback and delivery stay atomic, versioned and independent of source", async () => {
  const temp = mkdtempSync(join(tmpdir(), "bcr-review-")),
    root = join(temp, "project");
  mkdirSync(root);
  writeFileSync(
    join(root, "work.json"),
    JSON.stringify({
      format: "bcr-project-1",
      id: "work",
      title: "Work",
      targets: [{ id: "page", runtime: "html", entry: "index.html" }],
    }),
  );
  writeFileSync(join(root, "index.html"), "<h1>First</h1>");
  const runner = startRunner({
    root,
    state: join(temp, "state"),
    origin: "http://localhost:5199",
    token: "review-test-token".repeat(4),
    port: 0,
  });
  const repo = runner.service.review;
  const produce = async (revision: string, kind: "preview" | "archive") => {
    const job = runner.jobs.start({
      id: "work",
      revision,
      target: "page",
      kind,
      requestId: crypto.randomUUID(),
    });
    for (let i = 0; i < 150; i++) {
      const current = runner.jobs.get(job.id);
      if (current.status === "succeeded") return current;
      if (current.status === "failed") throw new Error(current.error);
      await Bun.sleep(30);
    }
    throw new Error("Job timeout");
  };
  const edit = (action: ReviewAction) =>
    repo.edit({
      id: "work",
      revision: repo.read("work").revision,
      requestId: crypto.randomUUID(),
      action,
    });
  try {
    const first = runner.projects.read("work");
    const preview = await produce(first.revision, "preview"),
      archive = await produce(first.revision, "archive");
    const input = {
      id: "work",
      revision: "initial",
      requestId: "submit-first",
      action: {
        kind: "submit",
        submissionId: "v1",
        sourceRevision: first.revision,
        target: "page",
        title: "First",
        summary: "First version",
        jobIds: [preview.id, archive.id],
        addresses: [],
      },
    };
    const submitted = repo.edit(input);
    expect(repo.edit(input)).toEqual(submitted);
    expect(() => repo.edit({ ...input, requestId: "stale" })).toThrow("冲突");
    expect(() =>
      edit({
        kind: "comment",
        feedbackId: "bad-frame",
        submissionId: "v1",
        comment: "Bad",
        anchor: { kind: "timeline", frame: 10 },
      }),
    ).toThrow("时间范围");
    edit({
      kind: "comment",
      feedbackId: "f1",
      submissionId: "v1",
      comment: "Improve title",
      anchor: {
        kind: "page",
        page: { path: "index.html", viewport: { width: 800, height: 600 } },
        point: { x: 0.3, y: 0.4 },
        context: "First",
      },
    });
    expect(runner.projects.read("work").revision).toBe(first.revision);
    writeFileSync(join(root, "index.html"), "<h1>Second</h1>");
    const second = runner.projects.read("work"),
      nextPreview = await produce(second.revision, "preview"),
      nextArchive = await produce(second.revision, "archive");
    expect(() =>
      edit({
        kind: "submit",
        submissionId: "wrong",
        sourceRevision: second.revision,
        target: "page",
        title: "Wrong",
        summary: "Wrong job",
        jobIds: [preview.id],
        addresses: [],
      }),
    ).toThrow("同一作品");
    edit({
      kind: "submit",
      submissionId: "v2",
      sourceRevision: second.revision,
      target: "page",
      title: "Second",
      summary: "Improved title",
      jobIds: [nextPreview.id, nextArchive.id],
      addresses: ["f1"],
    });
    expect(repo.read("work").feedback[0]!.status).toBe("addressed");
    const delivery: ReviewAction = {
      kind: "deliver",
      deliveryId: "d1",
      title: "Release",
      selections: [
        { submissionId: "v2", outputs: [repo.read("work").submissions[1]!.outputs[0]!.key] },
      ],
    };
    expect(() => edit(delivery)).toThrow("未确认");
    expect(() =>
      edit({ kind: "decide", feedbackId: "f1", submissionId: "v1", decision: "accept" }),
    ).toThrow("修改版本");
    edit({ kind: "decide", feedbackId: "f1", submissionId: "v2", decision: "accept" });
    const released = edit(delivery);
    writeFileSync(join(root, "index.html"), "<h1>Third</h1>");
    expect(repo.read("work").deliveries).toEqual(released.deliveries);
    edit({ kind: "decide", feedbackId: "f1", submissionId: "v2", decision: "reopen" });
    expect(repo.read("work").deliveries).toEqual(released.deliveries);
    expect(new ReviewRepository(runner.projects, runner.jobs).read("work")).toEqual(
      repo.read("work"),
    );
    expect(repo.edit(input).submissions).toHaveLength(2); // Replay never duplicates or reopens a submission.
  } finally {
    await runner.close();
    rmSync(temp, { recursive: true, force: true });
  }
}, 15000);

test("temporal and spatial anchors preserve exact meaning and reject invalid ranges", () => {
  const submission: Submission = {
    id: "v1",
    title: "Clip",
    summary: "Clip",
    sourceRevision: "source-1",
    target: {
      id: "vertical",
      runtime: "remotion",
      entry: "Scene.tsx",
      width: 1080,
      height: 1920,
      fps: 30,
      durationInFrames: 120,
    },
    outputs: [],
    addresses: [],
    createdAt: 0,
  };
  const book = { ...emptyReviewBook(), submissions: [submission] };
  const action: Extract<ReviewAction, { kind: "comment" }> = {
    kind: "comment" as const,
    submissionId: "v1",
    feedbackId: "f1",
    comment: "Delay reveal",
    anchor: { kind: "timeline", frame: 30, endFrame: 60, point: { x: 0.4, y: 0.2 } },
  };
  expect(editReviewBook(book, action, "rev-1", 0).feedback[0]!.anchor).toEqual(action.anchor);
  expect(() =>
    editReviewBook(
      book,
      { ...action, anchor: { kind: "timeline", frame: 60, endFrame: 30 } },
      "rev-1",
      0,
    ),
  ).toThrow("时间范围");
  expect(() =>
    editReviewBook(
      book,
      { ...action, anchor: { kind: "timeline", frame: 30, endFrame: 120 } },
      "rev-1",
      0,
    ),
  ).toThrow("时间范围");
});
