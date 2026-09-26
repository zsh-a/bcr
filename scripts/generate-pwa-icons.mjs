/* Rasterize the existing SVG icon family for install surfaces requiring PNG. */
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { createElement } from "../apps/studio/node_modules/react/index.js";
import { renderToStaticMarkup } from "../apps/studio/node_modules/react-dom/server.node.js";
import {
  LayoutGrid,
  Blocks,
  Globe2,
  Film,
  ChartNoAxesCombined,
  BookImage,
  FileText,
  Database,
  FilePlus2,
} from "../apps/studio/node_modules/lucide-react/dist/cjs/lucide-react.js";
const icons = {
  workspace: LayoutGrid,
  studio: Blocks,
  markets: Globe2,
  media: Film,
  quant: ChartNoAxesCombined,
  manga: BookImage,
  documents: FileText,
  data: Database,
  docgen: FilePlus2,
};
const directory = "apps/studio/public/icons";
for (const [key, icon] of Object.entries(icons)) {
  const drawing = renderToStaticMarkup(
    createElement(icon, { width: 96, height: 96, color: "#ede9e0", strokeWidth: 1.6 }),
  );
  await writeFile(
    `${directory}/${key}-icon.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 192 192"><rect width="192" height="192" rx="42" fill="#147a73"/><g transform="translate(48 48)">${drawing}</g></svg>\n`,
  );
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const key of [...Object.keys(icons), "reader", "knowledge"]) {
    const svg = await readFile(
      `${directory}/${key}-icon${["reader", "knowledge"].includes(key) ? "-192" : ""}.svg`,
      "utf8",
    );
    for (const size of [192, 512]) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<style>body{margin:0}body>svg{width:100vw;height:100vh}</style>${svg}`,
      );
      await page.screenshot({ path: `${directory}/${key}-icon-${size}.png`, omitBackground: true });
    }
  }
} finally {
  await browser.close();
}
