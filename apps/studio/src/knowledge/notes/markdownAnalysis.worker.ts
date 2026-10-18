import { markdownFacts } from "./markdownAnalysis";

self.addEventListener("message", (event: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = event.data;
  try {
    if (typeof source !== "string" || source.length > 500_100) throw new Error("笔记分析输入无效");
    self.postMessage({ id, facts: markdownFacts(source) });
  } catch (reason) {
    self.postMessage({ id, error: String(reason) });
  }
});
