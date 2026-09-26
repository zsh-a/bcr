/* Run with Bun after adding an app identity or changing the shared HTML shell. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PWA_APPS, webManifest } from "../apps/studio/src/pwa/apps.ts";
const root = "apps/studio";
const template = await readFile(`${root}/index.html`, "utf8");
for (const app of PWA_APPS) {
  const manifest = `${root}/public${app.manifestUrl}`;
  await mkdir(manifest.slice(0, manifest.lastIndexOf("/")), { recursive: true });
  await writeFile(manifest, `${JSON.stringify(webManifest(app), null, 2)}\n`);
  if (app.key === "knowledge") continue;
  const html = template
    .replace('content="BCR Workspace"', `content="${app.name}"`)
    .replace(
      "<title>BCR</title>",
      `<link rel="manifest" href="${app.manifestUrl}" />\n    <title>${app.name}</title>`,
    )
    .replace("/icons/workspace-icon-192.png", `/icons/${app.icon}-icon-192.png`)
    .replace("/src/main.tsx", "/src/pwa/main.ts");
  const directory = `${root}/pwa/${app.key}`;
  await mkdir(directory, { recursive: true });
  await writeFile(`${directory}/index.html`, html);
}
