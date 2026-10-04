import { renderToStaticMarkup } from "react-dom/server";
import { formatDecimal } from "@bcr/economics-core";
import { renderAnalysisChart } from "@bcr/visual-renderer/analysis";
import { FONT_FAMILY } from "@bcr/visual-renderer/model";
import { analysisRuns, type ContentProject } from "../model";
import { decodePage, type PageSpec } from "./model";
import { PageView } from "./PageView";
import css from "./pages.css?raw";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/gu,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
/** Static, standalone HTML with no scripts, network fonts, credentials or model calls. */
export function pageHtml(project: ContentProject, input: PageSpec, font?: Uint8Array): string {
  const page = decodePage(input, project.models ?? []);
  let fontStyle = "";
  if (font) {
    let bytes = "";
    for (let i = 0; i < font.length; i += 8192)
      bytes += String.fromCharCode(...font.subarray(i, i + 8192));
    fontStyle = `@font-face{font-family:'${FONT_FAMILY}';src:url(data:font/woff;base64,${btoa(bytes)}) format('woff')} .content-page,.content-page h1{font-family:'${FONT_FAMILY}',sans-serif}`;
  }
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'"><title>${escape(page.title)}</title><style>body{margin:0;background:#eeeae0}${css}${fontStyle}</style><body>${renderToStaticMarkup(<PageView project={project} page={page} />)}</body></html>`;
}

/** Export layout is explicit and bounded; it shares data and blocks with the React renderer. */
export function pageSvg(project: ContentProject, input: PageSpec): string {
  const page = decodePage(input, project.models ?? []),
    runs = analysisRuns(project);
  const width = page.layout === "portrait" ? 760 : 1200,
    margin = 48;
  const dark = page.theme === "night",
    ink = dark ? "#e3eee7" : "#243b32",
    muted = dark ? "#abc2b2" : "#64766c",
    paper = dark ? "#192b24" : "#f7f4ec";
  const text = (value: string, x: number, y: number, w: number, size = 20, color = ink) => {
    const lines: string[] = [];
    for (const paragraph of value.split("\n")) {
      let line = "",
        pixels = 0;
      for (const c of paragraph) {
        const cw = c.charCodeAt(0) > 255 ? size : size * 0.6;
        if (pixels + cw > w && line) {
          lines.push(line);
          line = "";
          pixels = 0;
        }
        line += c;
        pixels += cw;
      }
      lines.push(line);
    }
    return {
      svg: lines
        .map(
          (line, i) =>
            `<text x="${x}" y="${y + size + i * size * 1.6}" fill="${color}" font-size="${size}">${escape(line)}</text>`,
        )
        .join(""),
      height: lines.length * size * 1.6,
    };
  };
  const draw = (id: string, x: number, y: number, w: number): { svg: string; height: number } => {
    const block = page.elements[id]!;
    if (block.type === "Stack" || block.type === "Columns") {
      const columns = block.type === "Columns" && w > 550 ? block.props.columns : 1,
        gap = block.type === "Stack" ? { compact: 12, normal: 24, wide: 36 }[block.props.gap] : 24;
      let svg = "",
        offset = 0;
      const children = block.children ?? [];
      for (let i = 0; i < children.length; i += columns) {
        const row = children
          .slice(i, i + columns)
          .map((child, col) =>
            draw(
              child,
              x + (col * (w + gap)) / columns,
              y + offset,
              (w - gap * (columns - 1)) / columns,
            ),
          );
        svg += row.map((r) => r.svg).join("");
        offset += Math.max(0, ...row.map((r) => r.height)) + gap;
      }
      return { svg, height: Math.max(0, offset - gap) };
    }
    if (block.type === "Heading")
      return text(
        block.props.text,
        x,
        y,
        w,
        block.props.level === 1 ? 38 : block.props.level === 2 ? 28 : 22,
      );
    if (block.type === "Text") {
      const run = runs.find((r) => r.model.id === block.props.model),
        review = block.props.model && block.props.reviewedRun !== run?.id;
      return text(`${review ? "[需要复核] " : ""}${block.props.text}`, x, y, w);
    }
    if (block.type === "Sources")
      return text(
        `${block.props.title}\n${project.evidence.length ? project.evidence.map((e, i) => `${i + 1}. ${e.title} · ${e.applicableDate || new Date(e.capturedAt).toISOString().slice(0, 10)} ${e.region} ${e.store}${e.url ? `\n${e.url}` : ""}`).join("\n") : "尚未添加外部资料；示例参数均为自设假设。"}`,
        x,
        y,
        w,
        16,
        muted,
      );
    const run = runs.find((r) => r.model.id === block.props.model)!;
    if (block.type === "Parameter") {
      const p = run.model.parameters.find((p) => p.id === block.props.parameter)!;
      return text(
        `${p.label}\n${p.value} ${p.unit}\n${p.provenance === "assumed" ? "自设假设" : p.provenance === "recorded" ? "实际记录" : "外部资料"}`,
        x,
        y,
        w,
        18,
      );
    }
    if (block.type === "Metric") {
      const value = run.result.rows.find((r) => r.id === (block.props.scenario ?? "base"))!.values[
        block.props.output
      ]!;
      return text(
        `${block.props.label}\n${formatDecimal(value)} ${run.result.columns.find((c) => c.id === block.props.output)!.unit}`,
        x,
        y,
        w,
        26,
      );
    }
    if (block.type === "Chart") {
      const title = text(block.props.title, x, y, w, 22),
        height = Math.max(280, Math.min(480, w * 0.55));
      const chart = renderAnalysisChart(
        run.result,
        block.props.outputs,
        block.props.kind,
        w,
        height,
        dark,
      ).replace(/bcr-chart/gu, `chart-${id}`);
      return {
        svg: title.svg + `<g transform="translate(${x},${y + title.height + 12})">${chart}</g>`,
        height: title.height + height + 12,
      };
    }
    const headers = [
      "情景",
      ...block.props.outputs.map((id) => {
        const c = run.result.columns.find((c) => c.id === id)!;
        return `${c.label} (${c.unit})`;
      }),
    ];
    const rows = [
      headers,
      ...run.result.rows.map((r) => [
        r.label,
        ...block.props.outputs.map((id) => formatDecimal(r.values[id]!)),
      ]),
    ];
    const cw = w / headers.length;
    let svg = "",
      height = 0;
    for (const row of rows) {
      const cells = row.map((v, i) => text(v, x + i * cw, y + height, cw - 12, 15));
      const h = Math.max(...cells.map((c) => c.height)) + 16;
      svg += cells.map((c) => c.svg).join("");
      height += h;
    }
    return { svg, height };
  };
  const content = draw(page.root, margin, 96, width - margin * 2),
    height = Math.ceil(content.height + 144);
  if (height > 24000 || width * height > 32_000_000)
    throw new Error("页面过长，请拆分页面后导出图片");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${escape(FONT_FAMILY)}"><rect width="100%" height="100%" fill="${paper}"/>${text("BCR / RESEARCH & CREATION", margin, 32, width - margin * 2, 14, muted).svg}${content.svg}</svg>`;
}
