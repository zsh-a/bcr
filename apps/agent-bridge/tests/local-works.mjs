import assert from "node:assert/strict";
import { cp, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { startRunner } from "../../work-runner/src/server.ts";

export async function verifyLocalWorks({ client, invoke, page, directory, origin, openPanel }) {
  const root = join(directory, "local-work");
  await cp(resolve("apps/work-runner/example"), root, { recursive: true });
  const token = "mcp-integration-".repeat(5);
  const runner = startRunner({
    root,
    state: join(directory, "runner-state"),
    origin,
    token,
    port: 0,
  });
  const call = (name, args, error = false) => invoke(client, `work_${name}`, args, error);
  try {
    await page.getByRole("button", { name: "关闭外部 Agent 面板" }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "连接本地工程", exact: true }).click();
    await page.getByLabel("Runner 地址").fill(`http://127.0.0.1:${runner.api.port}`);
    await page.getByLabel("配对密钥").fill(token);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByRole("button", { name: "本地已连接", exact: true }).waitFor();
    const list = await call("list", {});
    assert(list.items.some((w) => w.provider === "browser"));
    assert(list.items.some((w) => w.provider === "local" && w.id === "gym-card"));
    const { work } = await call("read", { provider: "local", id: "gym-card" });
    assert.equal(work.directory, root);
    const source = {
      sourceId: work.ref.sourceId,
      id: work.ref.id,
      revision: work.revision,
      target: "page",
    };
    const wait = async (jobId) => {
      for (let i = 0; i < 900; i++) {
        const job = await call("jobs", { jobId });
        if (job.status === "succeeded") return job;
        assert(["queued", "running"].includes(job.status), JSON.stringify(job));
        await Bun.sleep(100);
      }
      throw new Error("Runner timeout");
    };
    const started = await call("render", {
      ...source,
      kind: "preview",
      requestId: "mcp-local-preview",
    });
    assert.equal(
      (await call("render", { ...source, kind: "preview", requestId: "mcp-local-preview" })).id,
      started.id,
    );
    await wait(started.id);
    await page.getByLabel("选择作品").selectOption(`${work.ref.sourceId}:gym-card`);
    await page.getByRole("button", { name: "制作与参数", exact: true }).click();
    const preview = await call("preview", {
      ...source,
      provider: "local",
      action: "start",
      jobId: started.id,
    });
    assert.equal(preview.status, "ready");
    assert.match(
      (await call("preview", { ...source, provider: "local", action: "inspect" })).result.text,
      /年卡/u,
    );
    const reviewRef = { sourceId: source.sourceId, id: source.id };
    const initialBook = await call("review_read", reviewRef);
    const submitted = await call("review_edit", {
      ...reviewRef,
      revision: initialBook.revision,
      requestId: "bridge-submit-page",
      action: {
        kind: "submit",
        submissionId: "bridge-page",
        sourceRevision: source.revision,
        target: "page",
        title: "页面审阅",
        summary: "检查布局",
        addresses: [],
        jobIds: [started.id],
      },
    });
    const view = await call("page_capture", {
      ...reviewRef,
      submissionId: "bridge-page",
      requestId: "bridge-page-capture",
      page: {
        path: work.targets.find((t) => t.id === "page").entry,
        viewport: { width: 768, height: 1024 },
      },
    });
    await call("review_edit", {
      ...reviewRef,
      revision: submitted.revision,
      requestId: "bridge-save-view",
      action: { kind: "view", view },
    });
    const pageImage = await call("page_image", { ...reviewRef, viewId: view.id });
    assert.equal(pageImage.artifact.mime, "image/png");
    const download = await invoke(client, "bcr_bridge_download", { artifact: pageImage.artifact });
    assert(download.url);
    console.log(
      "PASS: Bridge captures submitted HTML, saves review views and exposes screenshot artifacts",
    );
    const reviews = await call("reviews", { id: source.id });
    const saved = await call("review", {
      id: source.id,
      revision: reviews.revision,
      requestId: "mcp-review",
      review: {
        id: "review-1",
        sourceRevision: source.revision,
        target: "page",
        comment: "增加来源说明",
        status: "open",
      },
    });
    assert.equal(saved.items[0].comment, "增加来源说明");
    assert.equal(
      (await call("read", { id: source.id, provider: "local" })).work.revision,
      source.revision,
    );
    await page.getByLabel("输出目标").selectOption("vertical");
    const animation = { ...source, target: "vertical" };
    const animationJob = await call("render", {
      ...animation,
      kind: "preview",
      requestId: "mcp-animation-preview",
    });
    await wait(animationJob.id);
    await call("preview", { ...animation, action: "start", jobId: animationJob.id });
    await call("preview", { ...animation, action: "seek", frame: 1050 });
    const trial = await call("preview", {
      ...animation,
      action: "parameters",
      values: { annualPrice: 1800 },
    });
    assert.equal(trial.preview.draft, true);
    assert.match(
      (await call("preview", { ...animation, action: "inspect" })).result.text,
      /去 36 次/u,
    );
    assert.equal(JSON.parse(await readFile(join(root, "data.json"), "utf8")).annualPrice, 1680);
    const reset = await call("preview", { ...animation, action: "parameters", values: null });
    assert.equal(reset.preview.draft, false);
    await page.getByLabel("年卡价格（元）", { exact: true }).fill("1900");
    const change = {
      id: source.id,
      revision: source.revision,
      target: "vertical",
      requestId: "mcp-params",
      values: { annualPrice: 1800 },
    };
    assert.match((await call("parameters", change, true)).message, /未保存/u);
    await page.getByRole("button", { name: "放弃修改", exact: true }).click();
    const updated = await call("parameters", change);
    assert.notEqual(updated.revision, source.revision);
    assert.equal(JSON.parse(await readFile(join(root, "data.json"), "utf8")).annualPrice, 1800);
    assert.match(
      (
        await call(
          "parameters",
          { ...change, requestId: "stale-params", values: { annualPrice: 2000 } },
          true,
        )
      ).message,
      /冲突/u,
    );
    const history = await call("versions", { sourceId: work.ref.sourceId, id: source.id });
    assert.equal(history.head, updated.revision);
    await call("checkpoint", {
      sourceId: work.ref.sourceId,
      id: source.id,
      revision: updated.revision,
      requestId: "mcp-checkpoint",
      message: "MCP 参数方案",
    });
    const diff = await call("diff", {
      sourceId: work.ref.sourceId,
      id: source.id,
      from: source.revision,
      to: updated.revision,
      path: "data.json",
    });
    assert(diff.detail.before.includes("1680") && diff.detail.after.includes("1800"));
    const restored = await call("restore", {
      sourceId: work.ref.sourceId,
      id: source.id,
      revision: updated.revision,
      restoreRevision: source.revision,
      requestId: "mcp-source-restore",
    });
    assert.equal(restored.revision, source.revision);
    assert.equal(JSON.parse(await readFile(join(root, "data.json"), "utf8")).annualPrice, 1680);
    const archive = await wait(
      (await call("render", { ...source, kind: "archive", requestId: "mcp-archive" })).id,
    );
    const output = await call("output", { jobId: archive.id, name: "source.tar.gz" });
    assert(output.artifact.size > 100 && output.artifact.hash.length === 64);
    assert.equal((await call("cancel", { jobId: archive.id })).status, "succeeded");
    console.log(
      "PASS: unified MCP providers, local job replay, private preview, reviews, draft protection, revisions and output artifacts",
    );
  } finally {
    await runner.close();
  }
  await openPanel(page);
}
