export const volumeStateLabels = {
  pending: "待生成",
  generating: "正在生成",
  saving: "正在保存",
  failed: "生成失败，可重试",
  cancelled: "已取消，可重试",
  downloaded: "已触发下载，可重新生成",
  saved: "已保存到文件",
  interrupted: "上次操作未完成，可重试",
} as const;
export type VolumeTaskState = keyof typeof volumeStateLabels;
export type VolumeTaskStates = Readonly<Record<number, VolumeTaskState>>;
// Frozen v1 storage vocabulary. Display labels above may change independently.
const legacyStates = new Map<string, VolumeTaskState>([
  ["待生成", "pending"],
  ["正在生成", "generating"],
  ["正在保存", "saving"],
  ["生成失败，可重试", "failed"],
  ["已取消，可重试", "cancelled"],
  ["已触发下载，可重新生成", "downloaded"],
  ["已保存到文件", "saved"],
  ["上次操作未完成，可重试", "interrupted"],
]);
export function decodeVolumeTaskState(value: unknown, version: 1 | 2): VolumeTaskState {
  if (typeof value !== "string") throw new Error("分卷任务状态无效");
  const state = version === 1 ? legacyStates.get(value) : value;
  if (!state || !Object.hasOwn(volumeStateLabels, state)) throw new Error("分卷任务状态无效");
  if (state === "generating" || state === "saving") return "interrupted";
  return state as VolumeTaskState;
}
export function hasVolumeOutput(state: VolumeTaskState | undefined): boolean {
  return state === "downloaded" || state === "saved";
}
export function nextPendingVolume(states: VolumeTaskStates, count: number): number {
  for (let index = 0; index < count; index++) if (!hasVolumeOutput(states[index])) return index;
  return 0;
}
