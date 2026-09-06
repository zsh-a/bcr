import {
  createTextCitation,
  decodeTextCitation,
  resolveTextCitation,
  withTextCitation,
  type TextCitation,
  type SearchIndex,
  type SearchResult,
  type RuntimeMetadata,
  type SearchDocument,
} from "@bcr/core";

export interface ResearchExcerpt {
  readonly id: string;
  readonly documentId: string;
  readonly title: string;
  readonly source: string;
  readonly route: string;
  readonly text: string;
  readonly note: string;
  readonly savedAt: number;
  readonly citation?: TextCitation;
  readonly owner?: string;
}
export interface ResearchCollection {
  readonly id: string;
  readonly name: string;
  readonly excerpts: ReadonlyArray<ResearchExcerpt>;
}
export interface ResearchLibrary {
  readonly version: 1;
  readonly collections: ReadonlyArray<ResearchCollection>;
}
export const EMPTY_RESEARCH: ResearchLibrary = { version: 1, collections: [] };
export const RESEARCH_KEY = "workspace/research.v1";

/** Only local, known content routes may be reopened or emitted as citations. */
export function citationRoute(value: string | undefined): string | undefined {
  if (!value || !/^\/(reader|documents|media|manga)(?:\?|$)/u.test(value)) return undefined;
  if ([...value].some((character) => character.charCodeAt(0) <= 32 || character === "\\"))
    return undefined;
  const url = new URL(value, "https://bcr.invalid");
  if (url.origin !== "https://bcr.invalid") return undefined;
  return `${url.pathname}${url.search}`;
}

export function excerptFromDocument(document: SearchDocument, now: number): ResearchExcerpt {
  const route = citationRoute(document.route);
  const text = document.body?.trim();
  if (!route || !text) throw new Error("这条结果没有可引用的正文或来源定位");
  return {
    id: crypto.randomUUID(),
    documentId: document.id,
    title: document.title,
    source: document.subtitle ?? document.source,
    route,
    text,
    note: "",
    savedAt: now,
  };
}

export function resultCitation(result: SearchResult): TextCitation | undefined {
  const { body, citation } = result.document;
  if (!body || !citation || !result.match || result.match.end - result.match.start > 512)
    return undefined;
  return createTextCitation(body, citation, result.match);
}
export function resultDocument(result: SearchResult): SearchDocument {
  const citation = resultCitation(result);
  if (!citation || !result.document.route) return result.document;
  const url = new URL(withTextCitation(result.document.route, citation), "https://bcr.invalid");
  if (url.pathname === "/reader") {
    url.searchParams.set("start", String(citation.start + citation.hit.start));
    url.searchParams.set("end", String(citation.start + citation.hit.end));
    url.searchParams.set("quote", citation.exact.slice(citation.hit.start, citation.hit.end));
  }
  return { ...result.document, route: `${url.pathname}${url.search}` };
}
export function excerptFromResult(result: SearchResult, now: number): ResearchExcerpt {
  const citation = resultCitation(result);
  const excerpt = excerptFromDocument(resultDocument(result), now);
  return {
    ...excerpt,
    owner: result.document.source,
    ...(citation ? { citation, text: citation.exact } : {}),
    ...(citation && result.document.kind === "reader-section"
      ? {
          source: `${excerpt.source.replace(/ · 正文 \d+–\d+$/u, "")} · 命中 ${citation.start + citation.hit.start + 1}–${citation.start + citation.hit.end}`,
        }
      : {}),
  };
}
export function sameExcerpt(left: ResearchExcerpt, right: ResearchExcerpt): boolean {
  if (left.citation && right.citation)
    return (
      left.text === right.text &&
      left.citation.source.scope === right.citation.source.scope &&
      left.citation.source.unit === right.citation.source.unit &&
      left.citation.start === right.citation.start &&
      left.citation.source.version === right.citation.source.version &&
      left.citation.hit.start === right.citation.hit.start &&
      left.citation.hit.end === right.citation.hit.end
    );
  return (
    !left.citation &&
    !right.citation &&
    left.documentId === right.documentId &&
    left.text === right.text
  );
}
export interface ExcerptStatus {
  readonly state: "unverified" | "exact" | "relocated" | "missing" | "changed" | "ambiguous";
  readonly label: string;
  readonly route: string;
}
export function assessExcerpt(
  excerpt: ResearchExcerpt,
  search: SearchIndex | undefined,
): ExcerptStatus {
  const anchor = excerpt.citation;
  const pending = !anchor || !excerpt.owner || !search?.isSourceLive(excerpt.owner);
  if (pending)
    return {
      state: "unverified",
      label: anchor ? "待核验 · 打开来源后检查" : "旧版或整段引用 · 未核验",
      route: excerpt.route,
    };
  const documents = search!
    .documents()
    .filter(
      (document) =>
        document.source === excerpt.owner &&
        document.citation?.scope === anchor.source.scope &&
        document.body !== undefined,
    );
  const resolved = resolveTextCitation(
    anchor,
    documents.map((document) => ({ text: document.body!, source: document.citation! })),
  );
  const label = {
    exact: "可定位 · 来源版本一致",
    relocated: "内容已变化 · 已重新定位",
    missing: "来源缺失 · 请恢复原资料",
    changed: "内容已变化 · 未找到原文",
    ambiguous: "内容已变化 · 多处匹配，请核对",
  }[resolved.status];
  let route =
    resolved.status === "exact" || resolved.status === "relocated"
      ? withTextCitation(documents[resolved.candidate]!.route ?? excerpt.route, anchor)
      : excerpt.route;
  if (
    (resolved.status === "exact" || resolved.status === "relocated") &&
    new URL(route, "https://bcr.invalid").pathname === "/reader"
  ) {
    const url = new URL(route, "https://bcr.invalid");
    url.searchParams.set("start", String(resolved.hit.start));
    url.searchParams.set("end", String(resolved.hit.end));
    route = `${url.pathname}${url.search}`;
  }
  return { state: resolved.status, label, route };
}

export function decodeResearch(raw: string | undefined): ResearchLibrary {
  if (raw === undefined) return EMPTY_RESEARCH;
  const value = JSON.parse(raw) as ResearchLibrary;
  if (!value || value.version !== 1 || !Array.isArray(value.collections)) {
    throw new Error("资料集合格式不受支持，原有数据已保留");
  }
  const ids = new Set<string>();
  for (const collection of value.collections) {
    if (
      !collection ||
      typeof collection.id !== "string" ||
      !collection.id ||
      ids.has(collection.id) ||
      typeof collection.name !== "string" ||
      !collection.name.trim() ||
      !Array.isArray(collection.excerpts)
    ) {
      throw new Error("资料集合损坏，原有数据已保留");
    }
    ids.add(collection.id);
    const excerptIds = new Set<string>();
    for (const item of collection.excerpts) {
      if (
        !item ||
        ![item.id, item.documentId, item.title, item.source, item.text, item.note].every(
          (v) => typeof v === "string",
        ) ||
        !item.id ||
        excerptIds.has(item.id) ||
        typeof item.route !== "string" ||
        !citationRoute(item.route) ||
        typeof item.savedAt !== "number" ||
        !Number.isFinite(new Date(item.savedAt).getTime()) ||
        (item.owner !== undefined && (typeof item.owner !== "string" || !item.owner)) ||
        (item.citation !== undefined &&
          (!decodeTextCitation(item.citation) || item.citation.exact !== item.text))
      ) {
        throw new Error("资料摘录损坏，原有数据已保留");
      }
      excerptIds.add(item.id);
    }
  }
  return value;
}

/** Writes are serialized and published only after persistence succeeds. */
export class ResearchStore {
  private value: ResearchLibrary = EMPTY_RESEARCH;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<() => void>();
  readonly ready: Promise<void>;
  constructor(private readonly metadata: RuntimeMetadata | undefined) {
    this.ready = this.load();
    // Consumers receive the original rejection through ready; discarded React renders
    // must not create an unhandled rejection before their effect subscribes.
    void this.ready.catch(() => undefined);
  }
  private async load() {
    if (!this.metadata) throw new Error("本地元数据不可用，无法保存资料集合");
    this.value = decodeResearch(await this.metadata.get(RESEARCH_KEY));
    this.emit();
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private emit() {
    for (const listener of this.listeners) listener();
  }
  update(change: (current: ResearchLibrary) => ResearchLibrary): Promise<void> {
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        await this.ready;
        const next = change(this.value);
        const raw = JSON.stringify(next);
        decodeResearch(raw);
        await this.metadata!.set(RESEARCH_KEY, raw);
        this.value = next;
        this.emit();
      });
    this.tail = operation;
    return operation;
  }
}

function markdownText(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/([\\`*_{}[\]()#+.!|~-])/gu, "\\$1");
}
export function exportResearch(collection: ResearchCollection, origin: string): string {
  const base = new URL(origin);
  if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("来源地址无效");
  const entries = collection.excerpts.map((item, index) => {
    const route = citationRoute(item.route);
    if (!route) throw new Error("来源定位无效");
    const href = new URL(route, base.origin).href.replace(/[()<>]/gu, (c) =>
      encodeURIComponent(c).replace(/\(/gu, "%28").replace(/\)/gu, "%29"),
    );
    return (
      `## ${index + 1}. ${markdownText(item.title)}\n\n` +
      item.text
        .split(/\r?\n/u)
        .map((line) => `> ${markdownText(line)}`)
        .join("\n") +
      `\n\n来源：${markdownText(item.source)} · [回到原文](<${href}>)\n\n` +
      `保存时间：${new Date(item.savedAt).toISOString()}\n` +
      (item.citation
        ? `来源版本：${item.citation.source.version}\n`
        : "来源版本：旧引用，未记录\n") +
      (item.note ? `\n笔记：\n\n${markdownText(item.note)}\n` : "")
    );
  });
  return `# ${markdownText(collection.name)}\n\n摘录为保存时的正文快照。来源链接需要在保留对应本地资料的 BCR 浏览器中打开。\n\n${entries.join("\n")}`;
}
