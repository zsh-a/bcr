import { useEffect, useState } from "react";
import { diffArrays } from "diff";
import "./diffView.css";

/**
 * 渲染式差异视图——词级增删片段，红/绿着色带槽标；不再出现任何原始 `<pre>`/JSON 倾倒。
 * 纯函数 `diffSpans` / `excerptSpans` 可独立测试；组件负责截断诚实提示与完整展开。
 */

export interface DiffSpan {
  kind: "same" | "removed" | "added" | "omitted";
  text: string;
}

/** 词元：CJK 逐字、拉丁词/数字段、空白段、其余逐符——中文也能得到词级差异。 */
const TOKENS =
  /\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{Letter}\p{Mark}\p{Number}_]+|[^\s\p{Letter}\p{Mark}\p{Number}_\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

/** 词级内联差异；超时或超长时退化为整段删除/新增，仍诚实且不丢内容。 */
export function diffSpans(before: string, after: string): DiffSpan[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const changes = diffArrays(before.match(TOKENS) ?? [], after.match(TOKENS) ?? [], {
    timeout: 80,
    maxEditLength: 4000,
  });
  if (!changes)
    return [
      ...(before ? [{ kind: "removed" as const, text: before }] : []),
      ...(after ? [{ kind: "added" as const, text: after }] : []),
    ];
  const spans: DiffSpan[] = [];
  for (const part of changes) {
    const kind = part.added ? "added" : part.removed ? "removed" : "same";
    const text = part.value.join("");
    const last = spans.at(-1);
    if (last && last.kind === kind) last.text += text;
    else if (text) spans.push({ kind, text });
  }
  return spans;
}

const DEFAULT_CONTEXT = 160;
const DEFAULT_CAP = 4000;
export const FULL_CAP = 40_000;

/**
 * 围绕全部改动的省略窗口：窗口含上下文片段，其余以 … 省略；
 * `truncated` 供调用方展示诚实说明。
 */
export function excerptSpans(
  before: string,
  after: string,
  { context = DEFAULT_CONTEXT, cap = DEFAULT_CAP } = {},
): { spans: DiffSpan[]; truncated: boolean } {
  if (before === after) {
    if (!before) return { spans: [], truncated: false };
    return before.length <= cap
      ? { spans: [{ kind: "same", text: before }], truncated: false }
      : {
          spans: [
            { kind: "omitted", text: "…" },
            { kind: "same", text: before.slice(0, cap) },
            { kind: "omitted", text: "…" },
          ],
          truncated: true,
        };
  }
  const shared = Math.min(before.length, after.length);
  let start = 0;
  while (start < shared && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  // 代理对不可从中间切开：边界落在低位半边时前移一位。
  if ((before.charCodeAt(start) & 0xfc00) === 0xdc00) start--;
  let end = 0;
  while (
    end < shared - start &&
    before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)
  )
    end++;
  if ((before.charCodeAt(before.length - end) & 0xfc00) === 0xdc00) end--;
  const from = Math.max(0, start - context);
  const toBefore = Math.min(before.length, before.length - end + context);
  const toAfter = Math.min(after.length, after.length - end + context);
  let sliceBefore = before.slice(from, toBefore),
    sliceAfter = after.slice(from, toAfter);
  let cut = sliceBefore.length > cap || sliceAfter.length > cap;
  if (sliceBefore.length > cap) sliceBefore = sliceBefore.slice(0, cap);
  if (sliceAfter.length > cap) sliceAfter = sliceAfter.slice(0, cap);
  const spans: DiffSpan[] = [];
  if (from > 0) spans.push({ kind: "omitted", text: "…" });
  spans.push(...diffSpans(sliceBefore, sliceAfter));
  const tail = cut || toBefore < before.length || toAfter < after.length;
  if (tail) spans.push({ kind: "omitted", text: "…" });
  return { spans, truncated: from > 0 || tail };
}

export function DiffView({
  before,
  after,
  beforeLabel = "修改前",
  afterLabel = "修改后",
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [full, setFull] = useState(false);
  useEffect(() => setFull(false), [before, after]);
  const excerpt = excerptSpans(before, after);
  const long = before.length + after.length > FULL_CAP;
  const spans = full
    ? long
      ? excerptSpans(before, after, { context: 2000, cap: FULL_CAP }).spans
      : diffSpans(before, after)
    : excerpt.spans;
  const truncated = full ? long : excerpt.truncated;
  return (
    <div className="knowledge-diff">
      <div className="knowledge-diff-legend">
        <span className="knowledge-diff-legend-removed" aria-hidden="true">
          −
        </span>
        <span>{beforeLabel}独有</span>
        <span className="knowledge-diff-legend-added" aria-hidden="true">
          +
        </span>
        <span>{afterLabel}独有</span>
      </div>
      <div
        className="knowledge-diff-flow"
        role="group"
        aria-label={`${beforeLabel}与${afterLabel}的内容差异`}
      >
        {spans.map((span, index) =>
          span.kind === "removed" ? (
            <del key={index} className="knowledge-diff-removed">
              {span.text}
            </del>
          ) : span.kind === "added" ? (
            <ins key={index} className="knowledge-diff-added">
              {span.text}
            </ins>
          ) : span.kind === "omitted" ? (
            <span key={index} className="knowledge-diff-omitted">
              {span.text}
            </span>
          ) : (
            <span key={index}>{span.text}</span>
          ),
        )}
      </div>
      {truncated && (
        <p className="knowledge-diff-note">省略未展示的内容，以 … 标记，可展开完整正文核对。</p>
      )}
      {(excerpt.truncated || full) && (
        <button
          type="button"
          className="ui-btn ui-btn-ghost ui-btn-sm"
          aria-pressed={full}
          onClick={() => setFull(!full)}
        >
          {full ? "仅看变更片段" : "查看完整正文"}
        </button>
      )}
    </div>
  );
}
