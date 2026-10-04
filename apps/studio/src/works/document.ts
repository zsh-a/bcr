import { parse } from "es-module-lexer/minimal/js";
import {
  parse as parseHtml,
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes as Tree,
} from "parse5";
import type { WorkspaceFiles } from "../workspace/files";
import type { Work } from "./model";
import bootstrap from "./runtime.js?raw";

export const PREVIEW_LIMIT = 10 * 1024 * 1024;
const CSP =
  "default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const json = (value: unknown) => JSON.stringify(value).replace(/</gu, "\\u003c");
function dataUrl(bytes: Uint8Array, mime: string) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Compile a closed file set into one offline document, shared by preview and export. */
export async function workDocument(work: Work, files: WorkspaceFiles): Promise<string> {
  if (!work.entry) throw new Error("请先设置 HTML 入口");
  if (work.files.reduce((sum, f) => sum + f.artifact.size, 0) > PREVIEW_LIMIT)
    throw new Error("预览和单页导出上限为 10 MiB；仍可导出完整归档");
  const assets: Record<string, string> = Object.create(null),
    texts = new Map<string, string>();
  for (const f of work.files) {
    const blob = await files.read(f.artifact);
    assets[f.path] = dataUrl(new Uint8Array(await blob.arrayBuffer()), f.artifact.mime);
    if (/\.(?:html?|css|m?js|json)$/iu.test(f.path)) texts.set(f.path, await blob.text());
  }
  const resolve = (ref: string, from: string): string => {
    if (!ref || /^(?:[a-z][a-z\d+.-]*:|\/|#)/iu.test(ref))
      throw new Error(`仅支持作品内相对文件：${ref}`);
    const url = new URL(
      ref,
      `https://work.invalid/${from.split("/").map(encodeURIComponent).join("/")}`,
    );
    const path = decodeURIComponent(url.pathname.slice(1));
    if (!Object.hasOwn(assets, path) || url.search || url.hash)
      throw new Error(`文件引用不存在或带查询参数：${ref}（${from}）`);
    return path;
  };
  const moduleKey = (path: string) => `bcr-file:/${path}`;
  const moduleSource = (source: string, from: string) => {
    const [imports] = parse(source);
    let result = source;
    for (const item of [...imports].reverse()) {
      if (item.d === -2) continue; // import.meta is browser-owned; its URL is a data URL.
      if (item.n === undefined) throw new Error(`动态 import 必须使用字符串字面量：${from}`);
      const path = resolve(item.n, from);
      if (!/\.m?js$/iu.test(path)) throw new Error(`模块依赖须为已构建的 JS：${path}`);
      compileModule(path);
      const specifier = moduleKey(path);
      result =
        result.slice(0, item.s) +
        (item.d >= 0 ? JSON.stringify(specifier) : specifier) +
        result.slice(item.e);
    }
    return result;
  };
  const imports: Record<string, string> = Object.create(null);
  const visited = new Set<string>();
  function compileModule(path: string) {
    if (visited.has(path)) return;
    const source = texts.get(path);
    if (source === undefined || !/\.m?js$/iu.test(path))
      throw new Error(`模块文件类型无效：${path}`);
    visited.add(path); // Cycles are resolved by the browser's native module graph.
    imports[moduleKey(path)] = dataUrl(
      new TextEncoder().encode(moduleSource(source, path)),
      "text/javascript",
    );
  }
  const css = (source: string, from: string) => {
    if (/@import\b/iu.test(source)) throw new Error(`请先合并 CSS @import：${from}`);
    return source.replace(
      /url\(\s*(["']?)([^)'"\s]+)\1\s*\)/giu,
      (_match, _quote: string, ref: string) =>
        /^(?:data:|#)/iu.test(ref) ? `url("${ref}")` : `url("${assets[resolve(ref, from)]}")`,
    );
  };
  // Parse an inert syntax tree: compilation cannot load resources or execute source code.
  const doc = parseHtml(texts.get(work.entry)!);
  function* elements(root: Tree.ParentNode): Generator<Tree.Element> {
    for (const node of root.childNodes) {
      if (!("tagName" in node)) continue;
      yield node;
      yield* elements(node);
      if ("content" in node) yield* elements((node as Tree.Template).content);
    }
  }
  const get = (node: Tree.Element, name: string) => node.attrs.find((a) => a.name === name)?.value;
  const remove = (node: Tree.Element, name: string) => {
    node.attrs = node.attrs.filter((a) => a.name !== name);
  };
  const set = (node: Tree.Element, name: string, value: string) => {
    remove(node, name);
    node.attrs.push({ name, value });
  };
  const text = (node: Tree.Element) =>
    node.childNodes
      .filter((c): c is Tree.TextNode => c.nodeName === "#text")
      .map((c) => c.value)
      .join("");
  const setText = (node: Tree.Element, value: string) => {
    node.childNodes = [{ nodeName: "#text", value, parentNode: node }];
  };
  const drop = (node: Tree.Element) => {
    if (node.parentNode)
      node.parentNode.childNodes = node.parentNode.childNodes.filter((c) => c !== node);
  };
  for (const node of elements(doc)) {
    if (
      ["base", "iframe", "frame", "frameset", "object", "embed", "title"].includes(node.tagName) ||
      (node.tagName === "meta" &&
        (get(node, "http-equiv") !== undefined || get(node, "charset") !== undefined))
    ) {
      drop(node);
      continue;
    }
    for (const attr of ["srcset", "ping", "action", "formaction", "target"]) remove(node, attr);
    const style = get(node, "style");
    if (style) set(node, "style", css(style, work.entry));
    if (node.tagName === "a" && !get(node, "href")?.startsWith("#")) remove(node, "href");
    if (node.tagName === "script") {
      const type = get(node, "type")?.toLowerCase() ?? "";
      if (type === "importmap")
        throw new Error("请将第三方依赖构建为本地模块后上传，不支持自定义 importmap");
      const src = get(node, "src");
      if (src) {
        const path = resolve(src, work.entry);
        if (type === "module") compileModule(path);
        const url = type === "module" ? imports[moduleKey(path)] : assets[path];
        if (!url) throw new Error(`模块文件类型无效：${path}`);
        set(node, "src", url);
        remove(node, "integrity");
        remove(node, "crossorigin");
      } else if (type === "module") {
        set(
          node,
          "src",
          dataUrl(
            new TextEncoder().encode(moduleSource(text(node), work.entry)),
            "text/javascript",
          ),
        );
        setText(node, "");
      }
    } else if (node.tagName === "link") {
      if (get(node, "rel")?.toLowerCase() === "stylesheet") {
        const path = resolve(get(node, "href") ?? "", work.entry);
        node.tagName = node.nodeName = "style";
        node.attrs = node.attrs.filter((a) => a.name === "media");
        setText(node, css(texts.get(path) ?? "", path));
      } else drop(node);
    } else if (node.tagName === "style") setText(node, css(text(node), work.entry));
    else
      for (const attr of [
        "src",
        "poster",
        ...(node.namespaceURI === "http://www.w3.org/2000/svg" ? ["href"] : []),
      ]) {
        const ref = get(node, attr);
        if (ref && !/^(?:data:|#)/iu.test(ref)) set(node, attr, assets[resolve(ref, work.entry)]!);
      }
  }
  const head = [...elements(doc)].find((node) => node.tagName === "head");
  if (!head) throw new Error("HTML 缺少可用的 head");
  const trusted = parseFragment(
    `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title></title><script type="importmap">${json({ imports })}</script><script>${bootstrap}\n;window.installWorkRuntime(${json(assets)});delete window.installWorkRuntime;</script>`,
  );
  const title = [...elements(trusted)].find((node) => node.tagName === "title")!;
  setText(title, work.title);
  for (const node of trusted.childNodes) node.parentNode = head;
  head.childNodes.unshift(...trusted.childNodes);
  // Always use standards mode even if the authored fragment omitted a doctype.
  doc.childNodes = doc.childNodes.filter((node) => node.nodeName !== "#documentType");
  return `<!doctype html>${serialize(doc)}`;
}
