import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// Start `bun run docgen` first. Artifacts stay outside the source tree.
const base = process.env.BCR_SCENE_URL ?? "http://127.0.0.1:5209";
const output = process.env.BCR_SCENE_OUTPUT ?? "/tmp/bcr-scene-renderer";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const executablePath =
  process.env.BCR_BROWSER_PATH ??
  (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath());
const browser = await chromium.launch({
  executablePath,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--enable-unsafe-webgpu",
    "--use-angle=swiftshader",
  ],
});
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text());
  });
  await page.goto(base, { waitUntil: "networkidle" });
  // The first import may trigger Vite's dependency optimizer and one full reload.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.evaluate(async (root) => {
        await import(`/@fs${root}/packages/scene-renderer/src/renderer.ts`);
      }, root);
      break;
    } catch (error) {
      if (attempt === 2 || !String(error).includes("Execution context was destroyed")) throw error;
      await page.waitForLoadState("networkidle");
    }
  }

  for (const backend of ["auto", "webgl", "fallback"]) {
    const results = await page.evaluate(
      async ({ root, backend }) => {
        const { createSceneRenderer } = await import(
          `/@fs${root}/packages/scene-renderer/src/index.ts`
        );
        const { createDocumentScene } = await import(
          `/@fs${root}/packages/docgen-core/src/photo-scene.ts`
        );
        if (backend === "fallback")
          Object.defineProperty(navigator, "gpu", { configurable: true, value: undefined });
        const renderer = await createSceneRenderer({
          backend: backend === "fallback" ? "auto" : backend,
        });
        const fixture = (landscape = false) => {
          const canvas = document.createElement("canvas");
          canvas.width = landscape ? 1700 : 1200;
          canvas.height = landscape ? 1200 : 1700;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#184662";
          ctx.fillRect(80, 80, canvas.width - 160, 150);
          ctx.fillStyle = "#fff";
          ctx.font = "bold 62px Arial";
          ctx.fillText("SCENE / SAMPLE", 115, 175);
          ctx.fillStyle = "#252b31";
          ctx.font = "30px Arial";
          for (let i = 0; i < (landscape ? 13 : 23); i++)
            ctx.fillText(`Printed content follows the surface.   ${i + 1}`, 95, 330 + i * 49);
          ctx.strokeStyle = "#dce2e6";
          ctx.strokeRect(80, 275, canvas.width - 160, canvas.height - 390);
          return canvas;
        };
        const image = fixture();
        const reports = [];
        const capture = async (name, scene, options) => {
          const start = performance.now();
          const photo = await renderer.render(scene, options);
          const decoded = await createImageBitmap(photo.blob);
          if (decoded.width !== photo.width || decoded.height !== photo.height)
            throw new Error("Encoded dimensions differ from metadata");
          decoded.close();
          const bytes = new Uint8Array(await photo.blob.arrayBuffer());
          const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map((n) => n.toString(16).padStart(2, "0"))
            .join("");
          const report = {
            name,
            width: photo.width,
            height: photo.height,
            backend: photo.backend,
            format: photo.blob.type,
            ms: performance.now() - start,
            digest,
            bytes: [...bytes],
          };
          reports.push(report);
          return report;
        };
        try {
          for (const preset of ["daylight", "studio", "warm"]) {
            const recipe = createDocumentScene(image, {
              scene: preset,
              size: { width: 900, height: 1200 },
            });
            await capture(`document-${preset}`, recipe.scene, recipe.render);
          }
          const landscape = createDocumentScene(fixture(true), {
            paper: "folded",
            scene: "studio",
            size: { width: 1200, height: 900 },
          });
          await capture("document-landscape", landscape.scene, landscape.render);
          const product = {
            objects: [
              {
                geometry: { kind: "box", width: 0.18, height: 0.12, depth: 0.09 },
                position: [-0.065, 0, 0.045],
                rotation: [0, 0, -0.14],
                material: { color: "#236980", roughness: 0.35 },
              },
              {
                geometry: { kind: "sphere", radius: 0.058 },
                position: [0.12, 0.015, 0.058],
                material: { color: "#e7b46c", roughness: 0.24, metalness: 0.5 },
              },
              {
                geometry: { kind: "plane", width: 4, height: 4 },
                frame: false,
                castShadow: false,
                material: { color: "#c9ccd0", roughness: 0.8 },
              },
            ],
            lights: [
              {
                kind: "hemisphere",
                sky: "#ebf1ff",
                ground: "#a1a2a5",
                direction: [0, 0, 1],
                intensity: 1.5,
              },
              {
                kind: "directional",
                position: [-0.4, 0.5, 0.8],
                intensity: 3,
                shadow: { radius: 3 },
              },
              { kind: "point", position: [0.25, -0.2, 0.3], intensity: 0.12 },
            ],
            camera: { kind: "auto", direction: [0.25, -0.7, 1], padding: 0.2 },
          };
          const first = await capture("product", product, {
            size: { width: 1200, height: 900 },
            format: "image/png",
          });
          const repeat = await capture("product-repeat", product, {
            size: { width: 1200, height: 900 },
            format: "image/png",
          });
          if (first.digest !== repeat.digest)
            throw new Error("The same scene and seed changed between renders");

          // All supported decoded image inputs must keep the same UV orientation.
          const marker = document.createElement("canvas");
          marker.width = marker.height = 128;
          const ctx = marker.getContext("2d");
          for (const [color, x, y] of [
            ["#ff0000", 0, 0],
            ["#00ff00", 64, 0],
            ["#0000ff", 0, 64],
            ["#ff00ff", 64, 64],
          ]) {
            ctx.fillStyle = color;
            ctx.fillRect(x, y, 64, 64);
          }
          const bitmap = await createImageBitmap(marker);
          const element = new Image();
          element.src = marker.toDataURL();
          await element.decode();
          const offscreen = new OffscreenCanvas(128, 128);
          offscreen.getContext("2d").drawImage(marker, 0, 0);
          for (const source of [marker, bitmap, element, offscreen]) {
            const photo = await renderer.render(
              {
                objects: [
                  {
                    geometry: { kind: "plane", width: 1, height: 1 },
                    material: { map: { source } },
                  },
                ],
                lights: [{ kind: "ambient", intensity: 3 }],
                camera: { kind: "auto", direction: [0, 0, 1] },
              },
              { size: { width: 258, height: 258 }, format: "image/png" },
            );
            const decoded = await createImageBitmap(photo.blob);
            const check = document.createElement("canvas");
            check.width = check.height = 258;
            const cc = check.getContext("2d", { willReadFrequently: true });
            cc.drawImage(decoded, 0, 0);
            decoded.close();
            for (let y = 60; y < 100; y += 3) {
              const tl = cc.getImageData(75, y, 1, 1).data;
              const bl = cc.getImageData(75, y + 120, 1, 1).data;
              if (!(tl[0] > tl[1] + 80 && tl[0] > tl[2] + 80 && bl[2] > bl[0] + 80))
                throw new Error(
                  `Image orientation/stride failure (${renderer.backend}/${source.constructor.name}): TL=${tl}, BL=${bl}`,
                );
            }
          }
          if (bitmap.width !== 128) throw new Error("Renderer closed a caller-owned bitmap");
          bitmap.close();

          // Failure after resource allocation must not break subsequent renders.
          let failed = false;
          try {
            await renderer.render({ ...product, camera: { kind: "auto", direction: [0, 1, 0] } });
          } catch {
            failed = true;
          }
          if (!failed) throw new Error("Degenerate camera was accepted");
          const queued = [
            renderer.render(product, { size: { width: 320, height: 240 }, format: "image/webp" }),
            renderer.render(product, { size: { width: 240, height: 320 } }),
          ];
          const disposing = renderer.dispose();
          const [a, b] = await Promise.all(queued);
          if (a.width !== 320 || b.height !== 320 || a.blob.type !== "image/webp")
            throw new Error("Concurrent exports crossed buffers");
          await disposing;
          await renderer.dispose();
          let rejected = false;
          try {
            await renderer.render(product);
          } catch {
            rejected = true;
          }
          if (!rejected) throw new Error("Disposed renderer accepted work");
        } finally {
          await renderer.dispose();
        }
        return reports;
      },
      { root, backend },
    );
    for (const result of results) {
      if (backend !== "auto") assert.equal(result.backend, "webgl");
      const extension = result.format === "image/png" ? "png" : "jpg";
      await writeFile(
        `${output}/${result.backend}-${result.name}.${extension}`,
        Buffer.from(result.bytes),
      );
      console.log(JSON.stringify({ ...result, bytes: result.bytes.length }));
    }
  }
  assert.deepEqual(errors, []);
  console.log(`Scene renderer verification passed. Artifacts: ${output}`);
} finally {
  await browser.close();
}
