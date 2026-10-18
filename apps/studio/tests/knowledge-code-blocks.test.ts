import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { codeBlockAt, codeLanguageChange } from "../src/knowledge/editor/codeBlocks";
import { codeLanguage, codeLanguageValue } from "../src/knowledge/editor/codeLanguages";
import { knowledgeMarkdownLanguage } from "../src/knowledge/editor/markdownEditor";

const stateFor = (doc: string) =>
  EditorState.create({ doc, extensions: [knowledgeMarkdownLanguage] });
describe("code block tools", () => {
  it("copies code rather than fences or nested Markdown containers, preserving empty lines", () => {
    for (const [source, expected] of [
      ["```ts title=x\na\n\nb🙂\n```", "a\n\nb🙂"],
      ["> ```ts\n> a\n> \n> b\n> ```", "a\n\nb"],
      ["- ```\n  a\n\n  b\n  ```", "a\n\nb"],
      ["~~~~python\na\n~~~~", "a"],
      ["```\na\n", "a\n"],
      ["```\n```", ""],
      ["   ```python\n   print(1)\n     print(2)\n   ```", "print(1)\n  print(2)"],
    ] as const) {
      const state = stateFor(source),
        start = source.indexOf(source.includes("~~~") ? "~~~" : "```");
      expect(codeBlockAt(state, start + 1)?.text).toBe(expected);
      expect(state.doc.toString()).toBe(source);
    }
  });
  it("changes only the language token and preserves attributes, fence length, selection and other blocks", () => {
    const source = "> ````ts title=demo\n> const n = 1;\n> ````\n\n~~~css\na{}\n~~~";
    const state = stateFor(source),
      block = codeBlockAt(state, 4)!;
    const changed = state.update({ changes: codeLanguageChange(block, "javascript") }).state;
    expect(changed.doc.toString()).toBe(source.replace("ts title=demo", "javascript title=demo"));
    expect(state.update({ changes: codeLanguageChange(block, "") }).state.doc.toString()).toBe(
      source.replace("ts title=demo", "text title=demo"),
    );
    expect(() => codeLanguageChange(block, "bad\n```\n")).toThrow("无效");
  });
  it("adds and removes the language on empty or unclosed fences without changing the code", () => {
    for (const source of ["```\n```", "~~~\na\n"]) {
      const state = stateFor(source),
        block = codeBlockAt(state, 1)!;
      const changed = state.update({ changes: codeLanguageChange(block, "yaml") }).state;
      expect(changed.doc.toString()).toBe(source.slice(0, 3) + "yaml" + source.slice(3));
      expect(
        changed
          .update({ changes: codeLanguageChange(codeBlockAt(changed, 1)!, "") })
          .state.doc.toString(),
      ).toBe(source);
    }
  });
  it("matches known aliases exactly and lazily loads real nested parsers", async () => {
    for (const [alias, name] of [
      ["js", "javascript"],
      ["TS title=x", "typescript"],
      ["YML", "yaml"],
      ["py", "python"],
    ] as const) {
      expect(codeLanguage(alias)?.name).toBe(name);
    }
    for (const info of ["", "text", "totally-unknown-javascript-language"])
      expect(codeLanguage(info)).toBeNull();
    expect(codeLanguageValue("plaintext")).toBe("");
    for (const name of [
      "javascript",
      "typescript",
      "json",
      "yaml",
      "python",
      "html",
      "css",
      "jsx",
      "tsx",
    ]) {
      expect((await codeLanguage(name)!.load()).language).toBeTruthy();
    }
    const state = stateFor("```javascript\nconst total = 42;\n```");
    expect(syntaxTree(state).resolveInner(state.doc.toString().indexOf("total") + 1).name).not.toBe(
      "CodeText",
    );
    expect(codeBlockAt(state, 1)?.text).toBe("const total = 42;");
  });
});
