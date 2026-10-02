import { analyzeMarkdown } from "./markdownAnalysis";
import type { NoteChangePlan } from "./changePlan";

/** 计划中被改写的链接引用数——撤销提示「已移动并更新 N 处链接」的诚实计数。 */
export function countRewrittenLinks(changes: NoteChangePlan["changes"]): number {
  let count = 0;
  for (const change of changes) {
    if (change.before.body === change.after.body) continue;
    const before = analyzeMarkdown(change.before.body).links,
      after = analyzeMarkdown(change.after.body).links;
    if (before.length !== after.length) {
      count += Math.abs(before.length - after.length) || 1;
      continue;
    }
    for (let index = 0; index < before.length; index++)
      if (before[index]!.target !== after[index]!.target) count++;
  }
  return count;
}
