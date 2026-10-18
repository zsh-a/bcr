import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
  analyzeMarkdown,
  analyzeEditorLinks,
  noteCharacterCount,
} from "../apps/studio/src/knowledge/notes/markdownAnalysis";
import { attachmentReferences } from "../apps/studio/src/knowledge/attachments/attachmentModel";

const paragraph =
  "# 标题\n\n中文🙂 **重点** 与 [[note|别名]] [外链](https://example.com)\n\n![图](attachment:picture)\n\n```js\nconst value = 42;\n```\n\n";
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const cases = [50_000, 150_000, 400_000].map((size) => ({
  label: `${size} characters`,
  source: paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size),
}));
cases.push({
  label: "300 wiki links in one paragraph",
  source: "普通文本 [[note|别名]] ".repeat(300),
});
const results = cases.map(({ label, source }) => {
  const samples: {
    analysis: number;
    attachments: number;
    count: number;
    editorLinks: number;
    total: number;
  }[] = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    // Each iteration is a new input snapshot: a cache hit must not hide typing costs.
    const body = `${source}\n输入${iteration}`;
    const start = performance.now();
    analyzeMarkdown(body);
    const analysis = performance.now();
    attachmentReferences(body);
    const attachments = performance.now();
    noteCharacterCount(body);
    const count = performance.now();
    analyzeEditorLinks(body);
    const editorLinks = performance.now();
    if (iteration)
      samples.push({
        analysis: analysis - start,
        attachments: attachments - analysis,
        count: count - attachments,
        editorLinks: editorLinks - count,
        total: editorLinks - start,
      });
  }
  const timing = Object.fromEntries(
    Object.keys(samples[0]!).map((key) => [
      key + "Ms",
      +median(samples.map((sample) => sample[key as keyof typeof sample])).toFixed(2),
    ]),
  );
  return {
    label,
    utf16Length: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
    ...timing,
  };
});
const implementation = createHash("sha256");
for (const name of [
  "notes/markdownAnalysis.ts",
  "notes/paths.ts",
  "attachments/attachmentModel.ts",
  "attachments/attachmentReferences.ts",
]) {
  const path = new URL(`../apps/studio/src/knowledge/${name}`, import.meta.url);
  if (existsSync(path)) implementation.update(name).update(readFileSync(path));
}
console.log(
  JSON.stringify(
    {
      head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      runtime: process.version,
      implementationSha256: implementation.digest("hex"),
      results,
    },
    null,
    2,
  ),
);
