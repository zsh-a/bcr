/**
 * 显示与模板格式化：属展示/编辑层的纯工具，不进领域模型（model.ts）与
 * 工作台状态机（workbench.ts），避免 UI 文案逻辑散落进数据模块。
 */

export function relativeTime(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "未知时间";
  const delta = now - ts;
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString();
}

/** 列表行日期：今天走 relativeTime 语义，昨天/N 天前递进，更早保留日期。 */
export function noteWhen(ts: number, now = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "未知时间";
  const dayStart = (value: number) => {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const days = Math.round((dayStart(now) - dayStart(ts)) / 86_400_000);
  if (days <= 0) return relativeTime(ts, now);
  if (days === 1) return "昨天";
  if (days < 7) return `${days} 天前`;
  return new Date(ts).toLocaleDateString();
}

/** 日戳 YYYY-MM-DD：日记与模板共用。 */
export function localDay(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** 模板变量替换：{{date}}/{{title}}，未知变量原样保留（不执行任何代码）。 */
export function fillTemplate(body: string, title: string, date = new Date()) {
  return body.replace(/\{\{(date|title)\}\}/gu, (_, name: string) =>
    name === "date" ? localDay(date) : title,
  );
}
