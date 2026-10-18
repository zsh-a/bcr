import { LanguageDescription } from "@codemirror/language";

export const codeLanguageChoices = [
  { value: "", label: "纯文本" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "jsx", label: "JSX" },
  { value: "tsx", label: "TSX" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "python", label: "Python" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
] as const;

const language = (
  name: string,
  aliases: string[],
  load: () => Promise<import("@codemirror/language").LanguageSupport>,
) => LanguageDescription.of({ name, alias: aliases, load });
const descriptions = [
  language("javascript", ["js"], () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript()),
  ),
  language("typescript", ["ts"], () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  ),
  language("jsx", [], () =>
    import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true })),
  ),
  language("tsx", [], () =>
    import("@codemirror/lang-javascript").then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  ),
  language("json", [], () => import("@codemirror/lang-json").then((m) => m.json())),
  language("yaml", ["yml"], () => import("@codemirror/lang-yaml").then((m) => m.yaml())),
  language("python", ["py"], () => import("@codemirror/lang-python").then((m) => m.python())),
  language("html", ["htm"], () => import("@codemirror/lang-html").then((m) => m.html())),
  language("css", [], () => import("@codemirror/lang-css").then((m) => m.css())),
];

/** Exact matching keeps unknown fences as plain text. */
export function codeLanguage(info: string) {
  const token = info.trim().split(/\s/u)[0]?.toLowerCase() ?? "";
  return descriptions.find((entry) => entry.name === token || entry.alias.includes(token)) ?? null;
}
export function codeLanguageValue(token: string) {
  return /^(?:text|txt|plain|plaintext)$/iu.test(token) ? "" : (codeLanguage(token)?.name ?? token);
}
