import assert from "node:assert/strict";
import { chromium } from "playwright";
import { sharedEpub, sharedPdf } from "./lib/pwa-reader-fixtures.mjs";
import { startPwaServer } from "./lib/pwa-server.mjs";

const server = await startPwaServer();
const browser = await chromium.launch({ channel: "chromium" });
const apps = {
  reader: {
    id: "/reader",
    url: "/pwa/reader/",
    manifest: "/manifest.webmanifest",
    target: "/pwa/reader/share",
  },
  knowledge: {
    id: "/notes/",
    url: "/notes/knowledge/",
    manifest: "/notes/manifest.webmanifest",
    target: "/notes/share",
  },
};
const errors = [];
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => errors.push(error.message));

page.setDefaultTimeout(20_000);
async function openApp(key) {
  await page.goto(`${server.origin}${apps[key].url}`);
  await page
    .locator(key === "reader" ? ".reader-workspace" : ".knowledge-app:not(.knowledge-boot-shell)")
    .waitFor({ timeout: 60_000 });
  await page.waitForFunction(
    (key) =>
      navigator.serviceWorker.controller?.scriptURL.includes(
        key === "reader" ? "/pwa/sw.js?app=reader" : "/notes/sw.js",
      ),
    key,
    { timeout: 60_000 },
  );
}
async function share(key, fields, files = []) {
  await page.evaluate(
    ({ target, fields, files }) => {
      const form = document.createElement("form");
      form.method = "POST";
      form.enctype = "multipart/form-data";
      form.action = target;
      for (const [name, value] of Object.entries(fields)) {
        const input = document.createElement("input");
        input.name = name;
        input.value = value;
        form.append(input);
      }
      if (files.length) {
        const input = document.createElement("input"),
          transfer = new DataTransfer();
        input.type = "file";
        input.name = "files";
        input.multiple = true;
        for (const file of files)
          transfer.items.add(
            new File([file.bytes ? new Uint8Array(file.bytes) : file.text], file.name, {
              type: file.mime ?? "text/plain",
            }),
          );
        input.files = transfer.files;
        form.append(input);
      }
      document.body.append(form);
      form.submit();
    },
    { target: apps[key].target, fields, files },
  );
  await page.waitForURL(
    (url) => url.searchParams.has("share") || url.searchParams.has("shareError"),
  );
  await page
    .getByRole("dialog", { name: key === "reader" ? "接收到阅读文件" : "接收到分享内容" })
    .waitFor();
}
try {
  for (const app of Object.values(apps)) {
    const manifest = await (await fetch(`${server.origin}${app.manifest}`)).json();
    assert.equal(manifest.id, app.id);
    assert.equal(manifest.share_target.action, app.target);
    assert.equal(manifest.share_target.method, "POST");
    assert(manifest.shortcuts.every((shortcut) => shortcut.url.startsWith(manifest.scope)));
  }
  // Real Chromium install/launch tests complement the mobile viewport flows below.
  const cdp = await browser.newBrowserCDPSession();
  for (const order of process.env.BCR_SKIP_PWA_INSTALL
    ? []
    : [
        ["reader", "knowledge"],
        ["knowledge", "reader"],
      ]) {
    const installed = [];
    try {
      for (const key of order) {
        const app = apps[key];
        console.log(`Installing ${key}`);
        await cdp.send("PWA.install", {
          manifestId: `${server.origin}${app.id}`,
          installUrlOrBundleUrl: `${server.origin}${app.url}`,
        });
        installed.push(app);
      }
      for (const app of installed) {
        const { targetId } = await cdp.send("PWA.launch", {
          manifestId: `${server.origin}${app.id}`,
        });
        let launched = "";
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
          launched = (await cdp.send("Target.getTargetInfo", { targetId })).targetInfo.url;
          if (launched === `${server.origin}${app.url}`) break;
          await new Promise((done) => setTimeout(done, 100));
        }
        assert.equal(launched, `${server.origin}${app.url}`);
        await cdp.send("Target.closeTarget", { targetId });
      }
    } finally {
      for (const app of installed)
        await cdp.send("PWA.uninstall", { manifestId: `${server.origin}${app.id}` });
    }
  }
  console.log("Verifying mobile offline workflows");
  await openApp("reader");
  await page.getByRole("button", { name: "导入第一本书", exact: true }).click({ trial: true });
  await page.getByRole("button", { name: "更多阅读操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "Reader 安装与离线" }).click();
  await page.locator('[data-offline-state="ready"]').waitFor({ timeout: 60_000 });
  const panel = page.getByRole("dialog", { name: "Reader · 安装与离线" });
  const box = await panel.locator(".reader-install-card").boundingBox();
  assert(box.y >= 0 && box.y + box.height <= 844, "installation panel fits a mobile viewport");
  await page.screenshot({ path: "/tmp/bcr-android-install.png", animations: "disabled" });
  await page.getByRole("button", { name: "关闭安装说明" }).click();
  await context.setOffline(true);
  await share("reader", {}, [
    {
      name: "Android分享测试.txt",
      text: "第一章\n\nAndroid离线分享正文，导入后仍然保存在本机。\n",
    },
  ]);
  const sharedUrl = page.url();
  await page.reload();
  await page.getByRole("button", { name: "导入书库", exact: true }).click();
  await page.getByRole("dialog", { name: "接收到阅读文件" }).waitFor({ state: "hidden" });
  assert((await page.locator(".reader-studio").innerText()).includes("Android离线分享正文"));
  assert.equal(
    await page.locator(".reader-welcome").count(),
    0,
    "personal books replace the welcome prompt",
  );
  await page.reload();
  await page.locator(".reader-workspace").waitFor();
  assert.equal(await page.getByRole("dialog", { name: "接收到阅读文件" }).count(), 0);
  await page.goto(sharedUrl);
  await page.getByRole("alert").filter({ hasText: "已处理或已过期" }).waitFor();
  await page
    .getByRole("dialog", { name: "接收到阅读文件" })
    .getByRole("button", { name: "关闭", exact: true })
    .last()
    .click();
  await share("reader", {}, [{ name: "broken.pdf", mime: "application/pdf", text: "invalid PDF" }]);
  await page.getByRole("button", { name: "导入书库", exact: true }).click();
  await page
    .getByRole("dialog", { name: "接收到阅读文件" })
    .getByRole("alert")
    .filter({ hasText: "分享内容已保留" })
    .waitFor();
  await page.reload();
  await page.getByRole("dialog", { name: "接收到阅读文件" }).getByText("broken.pdf").waitFor();
  await page.getByRole("button", { name: "移除这份分享" }).click();
  await page.getByRole("button", { name: "撤销移除", exact: true }).click();
  await page.getByRole("dialog", { name: "接收到阅读文件" }).getByText("broken.pdf").waitFor();
  await page.getByRole("button", { name: "移除这份分享" }).click();
  for (const file of [await sharedEpub(), sharedPdf()]) {
    await share("reader", {}, [file]);
    await page.getByRole("button", { name: "导入书库", exact: true }).click();
    await page.getByRole("dialog", { name: "接收到阅读文件" }).waitFor({ state: "hidden" });
    if (file.name.endsWith(".epub"))
      assert((await page.locator(".reader-studio").innerText()).includes("Shared EPUB content"));
    else await page.locator(".reader-pdf-page .is-ready").first().waitFor();
  }
  await page.goto(`${server.origin}${apps.reader.url}?action=library`);
  await page.waitForFunction(() => !new URLSearchParams(location.search).has("action"));
  await page.locator(".reader-library-panel").first().waitFor();
  await context.setOffline(false);
  await openApp("knowledge");
  await share("knowledge", { title: "稍后整理", text: "暂存后重新打开仍应保留。" });
  await page.getByRole("button", { name: "稍后处理", exact: true }).click();
  assert.equal(new URL(page.url()).searchParams.has("share"), false);
  await page.reload();
  await page.getByRole("button", { name: "待接收的分享 · 1", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "接收到分享内容" }).count(), 0);
  await page.getByRole("button", { name: "待接收的分享 · 1", exact: true }).click();
  await page.getByRole("button", { name: "移除这份分享" }).click();
  await page.getByRole("button", { name: "撤销移除", exact: true }).click();
  await page
    .getByRole("dialog", { name: "接收到分享内容" })
    .getByText("稍后整理", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "移除这份分享" }).click();
  await share("knowledge", {
    title: "Android收藏",
    text: "值得再读 https://example.com/reference",
  });
  const noteShareUrl = page.url();
  await openApp("reader");
  assert.equal(
    await page.getByRole("dialog", { name: "接收到阅读文件" }).count(),
    0,
    "Reader never consumes a Knowledge share",
  );
  await context.setOffline(true);
  await page.goto(noteShareUrl);
  await page.getByRole("button", { name: "保存为笔记", exact: true }).click();
  await page.getByRole("dialog", { name: "接收到分享内容" }).waitFor({ state: "hidden" });
  assert(
    (await page.getByLabel("笔记正文", { exact: true }).innerText()).includes(
      "https://example.com/reference",
    ),
  );
  await page.reload();
  await page.getByLabel("笔记正文", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "接收到分享内容" }).count(), 0);
  // A crash after saving but before acknowledging a share must not create a second note.
  const noteId = new URL(page.url()).searchParams.get("note");
  const shareId = new URL(noteShareUrl).searchParams.get("share");
  await page.evaluate(
    ({ id }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("bcr-share-inbox", 1);
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction("shares", "readwrite");
          tx.objectStore("shares").put({
            id,
            app: "knowledge",
            title: "Android收藏",
            text: "值得再读 https://example.com/reference",
            url: "",
            files: [],
            bytes: 100,
            createdAt: Date.now(),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    { id: shareId },
  );
  await page.goto(noteShareUrl);
  await page.getByRole("button", { name: "保存为笔记", exact: true }).click();
  await page.getByRole("dialog", { name: "接收到分享内容" }).waitFor({ state: "hidden" });
  assert.equal(new URL(page.url()).searchParams.get("note"), noteId);
  await page.goto(`${server.origin}${apps.knowledge.url}?action=new`);
  await page.waitForFunction(
    () =>
      new URLSearchParams(location.search).has("note") &&
      !new URLSearchParams(location.search).has("action"),
  );
  const created = new URL(page.url()).searchParams.get("note");
  assert.notEqual(created, noteId);
  await page.reload();
  await page.getByLabel("笔记正文", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("note"), created);
  await share("knowledge", { url: "javascript:alert(1)" });
  await page.getByRole("alert").filter({ hasText: "仅支持 http" }).waitFor();
  assert.equal(server.postedFiles(), 0, "share content never reaches the HTTP server");
  assert.deepEqual(errors, []);
  console.log(
    "Android PWA PASSED: independent installation, mobile offline status, durable offline shares, app isolation and invalid-content recovery",
  );
} catch (error) {
  console.error(error);
  console.error(
    await page
      .locator("body")
      .innerText()
      .catch(() => ""),
  );
  await page.screenshot({ path: "/tmp/bcr-android-failure.png" }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
  await server.close();
}
