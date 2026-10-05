import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ensureShots } from "../../../scripts/lib/browser.mjs";

/** Three unrelated works use the same file/runtime contract; none have host-side templates. */
export async function verifyWorks({
  client,
  invoke,
  page,
  browser,
  cli,
  directory,
  origin,
  openPanel,
  connect,
}) {
  const call = (name, args, error = false) => invoke(client, `work_${name}`, args, error);
  const catalog = await call("catalog", {});
  assert(catalog.commit.properties.put);
  const examples = [
    {
      title: "任意成本计算器",
      expected: "60",
      selector: "#result",
      changed: "30",
      interaction: { action: "input", selector: "#visits", value: "60" },
      put: [
        {
          path: "index.html",
          text: '<link rel="stylesheet" href="style.css"><h1>使用成本</h1><label>次数<input id="visits" type="number" value="30"></label><output id="result"></output><script type="module" src="./app.js"></script>',
        },
        {
          path: "style.css",
          text: "body{font-family:system-ui;padding:32px;color:#184e42}output{display:block;font-size:48px}input{margin:20px}",
        },
        {
          path: "app.js",
          text: 'import { cost } from "./lib/cost.js"; const input = document.querySelector("#visits"); const update = () => document.querySelector("#result").textContent = cost(+input.value); input.addEventListener("input", update); update();',
        },
        { path: "lib/cost.js", text: "export const cost = n => String(1800 / n);" },
      ],
    },
    {
      title: "资料筛选浏览器",
      expected: "AppleBanana",
      selector: "#result",
      changed: "Banana",
      interaction: { action: "input", selector: "#filter", value: "Ban" },
      put: [
        {
          path: "index.html",
          text: '<h1>资料筛选</h1><input id="filter"><div id="result"></div><script type="module" src="./app.js"></script>',
        },
        { path: "data.json", text: '[{"title":"Apple"},{"title":"Banana"}]' },
        {
          path: "app.js",
          text: 'const data = JSON.parse(await bcr.readText("data.json")); const filter = document.querySelector("#filter"); const update = () => document.querySelector("#result").textContent = data.filter(x => x.title.includes(filter.value)).map(x => x.title).join(""); filter.addEventListener("input", update); update();',
        },
      ],
    },
    {
      title: "可交互时间线",
      expected: "2025 起点",
      selector: "#result",
      changed: "2026 新阶段",
      interaction: { action: "click", selector: "#next" },
      put: [
        {
          path: "index.html",
          text: '<h1>时间线</h1><p id="result"></p><button id="next">下一年</button><script type="module" src="./app.js"></script>',
        },
        {
          path: "app.js",
          text: 'const { labels } = await import("./labels.js"); let i = 0; const update = () => document.querySelector("#result").textContent = labels[i]; document.querySelector("#next").onclick = () => { i = (i + 1) % labels.length; update(); }; update();',
        },
        { path: "labels.js", text: 'export const labels = ["2025 起点", "2026 新阶段"];' },
      ],
    },
  ];
  const works = [];
  for (const [i, example] of examples.entries()) {
    const args = {
      requestId: `work-create-${i}`,
      revision: null,
      entry: "index.html",
      title: example.title,
      put: example.put,
    };
    const work = await call("commit", args);
    assert.deepEqual(await call("commit", args), work);
    works.push(work);
    const target = { id: work.id, revision: work.revision };
    const started = await call("preview", { ...target, action: "start" });
    assert.equal(started.status, "ready", JSON.stringify(started));
    const inspected = await call("preview", {
      ...target,
      action: "inspect",
      selector: example.selector,
    });
    assert.equal(inspected.result.text, example.expected, JSON.stringify(inspected));
    await call("preview", { ...target, ...example.interaction });
    const changed = await call("preview", {
      ...target,
      action: "inspect",
      selector: example.selector,
    });
    assert.equal(changed.result.text, example.changed);
    assert.deepEqual(
      changed.preview.reports.filter((r) => r.level === "error"),
      [],
    );
    const exported = await call("export", { ...target, format: "html" });
    const file = await invoke(client, "bcr_bridge_download", { artifact: exported.artifact });
    const path = join(directory, `work-${i}.html`);
    await cli("download", file.url, "--out", path);
    const offline = await browser.newContext({ offline: true }),
      reader = await offline.newPage();
    try {
      await reader.goto(pathToFileURL(path).href);
      await reader.locator(example.selector).filter({ hasText: example.expected }).waitFor();
      if (example.interaction.action === "input")
        await reader.locator(example.interaction.selector).fill(example.interaction.value);
      else await reader.locator(example.interaction.selector).click();
      await reader.locator(example.selector).filter({ hasText: example.changed }).waitFor();
    } finally {
      await offline.close();
    }
  }
  const first = works[0],
    target = { id: first.id, revision: first.revision };
  const archive = await call("export", { ...target, format: "archive" });
  const restored = await call("import", {
    requestId: "work-archive-restore",
    artifact: archive.artifact,
  });
  assert.notEqual(restored.id, first.id);
  assert.deepEqual(restored.files, first.files);
  const guarded = await call("commit", {
    requestId: "work-isolation",
    revision: null,
    entry: "index.html",
    put: [
      {
        path: "index.html",
        text: `<h1 id="result"></h1><script>try { parent.localStorage.getItem('secret'); document.querySelector('#result').textContent = 'leaked'; } catch { document.querySelector('#result').textContent = 'isolated'; } console.error('diagnostic marker'); fetch('https://example.invalid/forbidden').catch(() => {}); addEventListener('message', e => { e.ports[0]?.postMessage({kind:'log',event:null}); e.ports[0]?.postMessage({kind:'log',event:{level:{toString:'bad'},message:null}}); });</script>`,
      },
    ],
  });
  const guardTarget = { id: guarded.id, revision: guarded.revision };
  await call("preview", { ...guardTarget, action: "start" });
  const isolated = await call("preview", {
    ...guardTarget,
    action: "inspect",
    selector: "#result",
  });
  assert.equal(isolated.result.text, "isolated");
  assert(isolated.preview.reports.some((r) => r.message.includes("diagnostic marker")));
  assert(isolated.preview.reports.some((r) => r.message.includes("connect-src")));
  await call("preview", { ...guardTarget, action: "stop" });
  console.log(
    "PASS: three unrelated works, native modules, JSON assets, interaction feedback, offline exports, archive restore and preview isolation",
  );

  await page.goto(`${origin}/works?work=${first.id}&mode=build`);
  await page.getByLabel("作品文件内容").waitFor();
  await openPanel(page);
  await connect(true);
  await page.getByRole("button", { name: "关闭外部 Agent 面板" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const editor = page.getByLabel("作品文件内容");
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="作品文件内容"]')?.value.includes("使用成本"),
  );
  await editor.fill(`${await editor.inputValue()}\n<!-- manual -->`);
  const patch = { requestId: "work-dirty", ...target, title: "Changed" };
  assert.match((await call("commit", patch, true)).message, /未保存/u);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "运行", exact: true }).waitFor();
  await page.waitForFunction(() =>
    document.querySelector(".build-statusbar")?.textContent.includes("已保存"),
  );
  assert.match((await call("commit", patch, true)).message, /版本冲突/u);
  const head = (await call("read", { id: first.id })).work;
  await call("preview", { id: head.id, revision: head.revision, action: "start" });
  const frame = page.frameLocator('iframe[title^="作品预览"]');
  await frame.locator("#result").filter({ hasText: "60" }).waitFor();
  assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${ensureShots()}/works-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.locator(".works-app").evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  await page.screenshot({ path: `${ensureShots()}/works-mobile.png` });
  await openPanel(page);
  console.log(
    "PASS: shared editor/Agent revisions, dirty draft protection, visible sandbox preview and responsive works workspace",
  );
}
