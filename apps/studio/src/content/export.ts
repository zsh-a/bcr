import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { renderAt, FONT_FAMILY } from "@bcr/visual-renderer";
import { renderPng } from "@bcr/visual-renderer/png";
import { evidenceSource } from "./model";
import { decodeRelease, type ReleaseSnapshot } from "./release";
import type { ContentAssets } from "./assets";
import license from "@ibm/plex-sans-sc/LICENSE.txt?raw";
import { attachmentId, rewriteMarkdownUrls } from "../knowledge/attachments/attachmentModel";
import { parseVisualUrl } from "./links";

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
export function fileTitle(title: string) {
  return title.replace(/[\\/:*?"<>|\p{Cc}]/gu, "_").slice(0, 100) || "内容项目";
}
export async function chartImage(release: ReleaseSnapshot, index: number, assets: ContentAssets) {
  const spec = release.project.visuals[index];
  if (!spec || !release.run) throw new Error("图表不存在");
  const font = new Uint8Array(await (await assets.read(release.font)).arrayBuffer());
  const svg = renderAt({
    spec: { ...spec, source: spec.source || evidenceSource(release.project) },
    result: release.run.result,
  });
  return { svg, png: await renderPng(svg, font), font };
}
function embeddedFont(svg: string, font: Uint8Array) {
  let bytes = "";
  for (let i = 0; i < font.length; i += 8192)
    bytes += String.fromCharCode(...font.subarray(i, i + 8192));
  return svg.replace(
    /(<svg[^>]*>)/u,
    `$1<defs><style>@font-face{font-family:'${FONT_FAMILY}';src:url(data:font/woff;base64,${btoa(bytes)}) format('woff');}</style></defs>`,
  );
}
const markdownText = (text: string) => text.replace(/[\\`*_[\]<>]/gu, "\\$&");
export function sourceNotes(release: ReleaseSnapshot) {
  const parameters = [
    ...Object.entries(release.run?.model.parameters ?? {}).map(
      ([key, p]) => `- ${key}: ${p.value} (${p.provenance})`,
    ),
    ...(release.analysis ?? []).flatMap((run) => [
      `### ${markdownText(run.model.title)}`,
      ...run.model.parameters.map(
        (p) =>
          `- ${markdownText(p.label)}: ${p.value} ${p.unit} (${p.provenance})${p.evidenceId ? ` — 来源 ID: ${p.evidenceId}` : ""}`,
      ),
    ]),
  ].join("\n");
  return `# 来源与计算说明\n\n${release.project.evidence.map((e, i) => `${i + 1}. ${markdownText(e.title)}${e.url ? ` — <${e.url.replaceAll(">", "%3E").replaceAll("<", "%3C")}>` : ""}\n   采集：${new Date(e.capturedAt).toISOString()}；适用：${markdownText([e.applicableDate, e.region, e.store, e.specification].filter(Boolean).join(" / ") || "未填写")}\n   作者：${markdownText(e.author || "未填写")}；许可：${markdownText(e.license || "未记录")}`).join("\n\n")}\n\n## 参数\n\n${parameters}\n\n公式与精确结果见 model.json。金额显示保留两位小数，内部使用 40 位有效数字。通用模型与情景结果见 analysis.json；参数单位独立保存。\n`;
}
export async function publishingPackage(
  snapshot: ReleaseSnapshot,
  assets: ContentAssets,
  signal?: AbortSignal,
): Promise<Blob> {
  const release = decodeRelease(snapshot);
  const zip = new ZipWriter(new BlobWriter("application/zip"));
  const options = { ...(signal ? { signal } : {}), useWebWorkers: false };
  try {
    const body = rewriteMarkdownUrls(release.article?.body ?? "", (url) => {
      const visual = parseVisualUrl(url);
      if (visual) return `charts/chart-${visual.index + 1}.png`;
      const id = attachmentId(url),
        asset = release.attachments.find((a) => a.id === id);
      return asset ? `attachments/${asset.hash}` : null;
    });
    for (let i = 0; i < release.project.visuals.length; i++) {
      signal?.throwIfAborted();
      const frame = await chartImage(release, i, assets);
      await zip.add(
        `charts/chart-${i + 1}.svg`,
        new TextReader(embeddedFont(frame.svg, frame.font)),
        options,
      );
      const png = new Blob([frame.png as BlobPart], { type: "image/png" });
      await zip.add(`charts/chart-${i + 1}.png`, new BlobReader(png), options);
      if (i === 0) await zip.add("cover.png", new BlobReader(png), options);
    }
    if (release.project.pages?.length) {
      const { pageSvg, pageHtml } = await import("./pages/export");
      const font = new Uint8Array(await (await assets.read(release.font)).arrayBuffer());
      for (const page of release.project.pages) {
        signal?.throwIfAborted();
        const svg = pageSvg(release.project, page);
        await zip.add(`pages/${page.id}.svg`, new TextReader(embeddedFont(svg, font)), options);
        await zip.add(
          `pages/${page.id}.png`,
          new BlobReader(
            new Blob([(await renderPng(svg, font)) as BlobPart], { type: "image/png" }),
          ),
          options,
        );
        await zip.add(
          `pages/${page.id}.html`,
          new TextReader(pageHtml(release.project, page, font)),
          options,
        );
        await zip.add(
          `pages/${page.id}.json`,
          new TextReader(JSON.stringify(page, null, 2)),
          options,
        );
      }
      await zip.add(
        "analysis.json",
        new TextReader(JSON.stringify(release.analysis ?? [], null, 2)),
        options,
      );
    }
    const written = new Set<string>();
    for (const attachment of release.attachments) {
      const path = `attachments/${attachment.hash}`;
      if (!written.has(path)) {
        await zip.add(path, new BlobReader(await assets.read(attachment)), options);
        written.add(path);
      }
    }
    await zip.add("article.md", new TextReader(body), options);
    await zip.add(
      "title.txt",
      new TextReader(release.article?.title ?? release.project.title),
      options,
    );
    await zip.add("sources.md", new TextReader(sourceNotes(release)), options);
    await zip.add("model.json", new TextReader(JSON.stringify(release.run, null, 2)), options);
    await zip.add(
      "release.json",
      new TextReader(
        JSON.stringify({ id: release.id, digest: release.digest, createdAt: release.createdAt }),
      ),
      options,
    );
    await zip.add("FONT-LICENSE.txt", new TextReader(license), options);
    return await zip.close();
  } catch (error) {
    await zip.close().catch(() => undefined);
    throw error;
  }
}
