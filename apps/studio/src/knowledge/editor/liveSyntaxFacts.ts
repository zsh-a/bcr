import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { MarkdownFacts } from "../notes/markdownAnalysis";

/** Mapped analysis is provisional: a new fence/HTML/link can change untouched text's meaning. */
export function validateLiveFacts(state: EditorState, facts: MarkdownFacts): MarkdownFacts {
  const tree = syntaxTree(state);
  const literal =
    /^(?:FencedCode|CodeBlock|InlineCode|HTMLBlock|HTMLTag|CommentBlock|Comment|LinkReference)$/u;
  const wiki = (link: { from: number; to: number }) => {
    if (
      state.sliceDoc(link.from, link.from + 2) !== "[[" ||
      state.sliceDoc(link.to - 2, link.to) !== "]]"
    )
      return false;
    let slash = link.from;
    while (slash > 0 && state.sliceDoc(slash - 1, slash) === "\\") slash--;
    if (
      (link.from - slash) % 2 ||
      state.sliceDoc(link.from - (link.from ? 1 : 0), link.from) === "!"
    )
      return false;
    for (let node = tree.resolveInner(link.from + 1, 1); node; node = node.parent!) {
      if (literal.test(node.name)) return false;
      if (
        (node.name === "Link" || node.name === "Image") &&
        node.from <= link.from &&
        node.to >= link.to
      )
        return false;
    }
    return tree.length >= link.to;
  };
  return {
    ...facts,
    analysis: {
      ...facts.analysis,
      links: facts.analysis.links.filter((link) => link.kind !== "wiki" || wiki(link)),
    },
    attachments: facts.attachments.filter((ref) => {
      for (let node = tree.resolveInner(ref.from + 1, 1); node; node = node.parent!) {
        if (literal.test(node.name)) return false;
        if (
          (node.name === "Image" || node.name === "Link") &&
          node.from === ref.from &&
          node.to === ref.to
        )
          return true;
      }
      return false;
    }),
  };
}
