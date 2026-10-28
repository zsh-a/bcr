import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const app = join(root, "apps/market-board");

await test(
  "controlled research references stay aligned through lock, keyboard and global clear",
  { timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "bcr-reference-lock-"));
    const socket = createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const packageRoot = await realpath(join(app, "node_modules/@bcr/market-data"));
    await symlink(join(app, "node_modules"), join(directory, "node_modules"));
    await writeFile(
      join(directory, "vite.config.ts"),
      `import react from "@vitejs/plugin-react"; export default { plugins: [react()], server: { fs: { allow: ${JSON.stringify([root, directory, resolve(packageRoot, "../..")])} } } };`,
    );
    await writeFile(
      join(directory, "index.html"),
      '<div id="root"></div><script type="module" src="/preview.tsx"></script>',
    );
    await writeFile(
      join(directory, "preview.tsx"),
      `
    import React, { useEffect, useState } from "react";
    import { createRoot } from "react-dom/client";
    import { getInstanceByDom } from "echarts/core";
    import { ResearchChart } from ${JSON.stringify(`/@fs${join(app, "src/research/ResearchChart.tsx")}`)};
    const point = (period, date, value) => ({ period, date, value, rawValue: value });
    const points = [point("2024-Q1", "2024-03-31", 0), point("2024-Q2", "2024-06-30", null), point("2024-Q4", "2024-12-31", 3)];
    const tracks = [{ series: { id: "USA:metric", metricId: "metric", country: "USA", frequency: "Q", unit: "percent", rawUnit: "percent", currency: null, seasonalAdjustment: "SA", valuation: null, source: { name: "Test", url: "https://example.com", seriesCode: "GDP" }, fetchedAt: "2025-01-01", sourceUpdatedAt: null, note: "", computed: false, observations: points }, points, plot: [...points.slice(0, 2), point("2024-Q3", "2024-09-30", null), points[2]], reading: { ...points[2], ageMonths: 0, change: null, previousPeriod: null }, coverage: { valid: 2, reported: 3, expected: 4 } }];
    const range = ["2024-01-01", "2024-12-31"], colors = { USA: "#347e8a" };
    function App() {
      const [hover, setHover] = useState(null), [locked, setLocked] = useState(null);
      const clear = () => { setHover(null); setLocked(null); };
      useEffect(() => { const escape = event => { if (event.key === "Escape") clear(); }; window.addEventListener("keydown", escape); return () => window.removeEventListener("keydown", escape); }, []);
      const props = { tracks, range, baseline: 0, cursorDate: locked ?? hover, onCursor: setHover, lockedDate: locked, onLock: setLocked, colors, label: "Quarterly comparison" };
      return <main style={{ width: 760 }}><output id="cursor">{locked ?? hover ?? "none"}</output><output id="locked">{locked ?? "none"}</output><button id="global-lock" onClick={() => setLocked("2024-06-30")}>Lock</button><button id="global-clear" onClick={clear}>Clear</button><section><ResearchChart {...props} height={138}/></section><section><ResearchChart {...props} height={280}/></section></main>;
    }
    window.chartInstances = () => [...document.querySelectorAll(".research-chart-canvas")].map(element => getInstanceByDom(element));
    createRoot(document.getElementById("root")).render(<App/>);
  `,
    );
    const server = spawn(
      join(root, "node_modules/.bin/vp"),
      [
        "dev",
        directory,
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
        "--config",
        join(directory, "vite.config.ts"),
      ],
      { cwd: root, stdio: "pipe", detached: process.platform !== "win32" },
    );
    let serverOutput = "";
    server.stdout.on("data", (chunk) => {
      serverOutput += chunk;
    });
    server.stderr.on("data", (chunk) => {
      serverOutput += chunk;
    });
    let browser;
    try {
      const url = `http://127.0.0.1:${port}/`;
      let listening = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          if ((await fetch(url)).ok) {
            listening = true;
            break;
          }
        } catch {
          /* startup */
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(listening, serverOutput);
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(
        () => document.querySelectorAll('.research-chart-canvas[data-ready="true"]').length === 2,
      );
      await page.evaluate(() => {
        window.optionCalls = 0;
        for (const chart of window.chartInstances()) {
          const original = chart.setOption.bind(chart);
          chart.setOption = (...args) => {
            window.optionCalls++;
            return original(...args);
          };
        }
      });
      const boxes = await Promise.all(
        [0, 1].map((index) => page.locator(".research-chart-canvas").nth(index).boundingBox()),
      );
      const move = async (index, fraction) => {
        const box = boxes[index];
        await page.mouse.move(box.x + box.width * fraction, box.y + 45);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      };
      const pinned = () =>
        page
          .locator(".research-chart-controls button")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-pressed")));
      const dates = () =>
        page
          .locator(".research-chart-canvas")
          .evaluateAll((charts) => charts.map((chart) => chart.dataset.cursorDate));

      await page.locator("#global-lock").click();
      assert.deepEqual(await pinned(), ["true", "true"]);
      const positions = await page
        .locator(".research-chart-cursor")
        .evaluateAll((lines) => lines.map((line) => line.style.transform));
      await move(1, 0.8);
      assert.equal(await page.locator("#cursor").textContent(), "2024-06-30");
      assert.deepEqual(await dates(), ["2024-06-30", "2024-06-30"]);
      assert.deepEqual(
        await page
          .locator(".research-chart-cursor")
          .evaluateAll((lines) => lines.map((line) => line.style.transform)),
        positions,
      );
      assert.match(
        await page.locator(".research-native-tooltip:not([hidden])").textContent(),
        /2024-06-30.*2024-Q2.*—/s,
      );

      await page.locator("#global-clear").click();
      assert.deepEqual(await pinned(), ["false", "false"]);
      await move(1, 0.8);
      assert.notEqual(await page.locator("#cursor").textContent(), "none");
      assert.notEqual(await page.locator("#cursor").textContent(), "2024-06-30");
      assert.equal(new Set(await dates()).size, 1);

      await page.locator(".research-chart-canvas").first().focus();
      await page.keyboard.press("Home");
      assert.equal(await page.locator("#locked").textContent(), "2024-03-31");
      assert.deepEqual(await pinned(), ["true", "true"]);
      await page.keyboard.press("ArrowRight");
      assert.equal(await page.locator("#locked").textContent(), "2024-06-30");
      assert.deepEqual(await dates(), ["2024-06-30", "2024-06-30"]);
      await page.locator(".research-chart-canvas").nth(1).focus();
      await page.keyboard.press("End");
      assert.deepEqual(await dates(), ["2024-12-31", "2024-12-31"]);
      await move(0, 0.3);
      assert.equal(await page.locator("#locked").textContent(), "2024-12-31");

      await page.locator("#global-clear").focus();
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#cursor").textContent(), "none");
      assert.deepEqual(await pinned(), ["false", "false"]);
      await move(0, 0.3);
      assert.notEqual(await page.locator("#cursor").textContent(), "none");
      await page.locator(".research-chart-controls button").first().click();
      assert.deepEqual(await pinned(), ["true", "true"]);
      await page.locator(".research-chart-controls button").nth(1).click();
      assert.deepEqual(await pinned(), ["false", "false"]);
      assert.equal(await page.locator("#cursor").textContent(), "none");
      await page
        .locator(".research-chart-canvas")
        .first()
        .dispatchEvent("pointerdown", {
          pointerType: "touch",
          clientX: boxes[0].x + boxes[0].width * 0.55,
          clientY: boxes[0].y + 45,
        });
      await page.waitForFunction(() => document.querySelector("#locked").textContent !== "none");
      assert.deepEqual(await pinned(), ["true", "true"]);
      assert.equal(new Set(await dates()).size, 1);
      assert.equal(await page.evaluate(() => window.optionCalls), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      if (process.platform === "win32") server.kill("SIGTERM");
      else if (server.pid) {
        try {
          process.kill(-server.pid, "SIGTERM");
        } catch {
          server.kill("SIGTERM");
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
