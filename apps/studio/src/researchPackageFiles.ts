import type { ResearchPackagePlan } from "./researchPackage";
type SaveWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;
};
function packageFilename(plan: ResearchPackagePlan, index: number): string {
  return `bcr-reader-research-${plan.set.slice(0, 12)}-${index + 1}-of-${plan.volumes.length}.zip`;
}
export function canSavePackageDirectly(): boolean {
  return typeof (window as SaveWindow).showSaveFilePicker === "function";
}
/** Invoke in the click call stack, before awaiting anything else. */
export async function openPackageDestination(
  plan: ResearchPackagePlan,
  index: number,
  signal: AbortSignal,
): Promise<WritableStream<Uint8Array>> {
  const handle = await (window as SaveWindow).showSaveFilePicker!({
    suggestedName: packageFilename(plan, index),
    types: [{ description: "Reader 资料包", accept: { "application/zip": [".zip"] } }],
  });
  signal.throwIfAborted();
  return handle.createWritable();
}
export function downloadPackage(blob: Blob, plan: ResearchPackagePlan, index: number): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = packageFilename(plan, index);
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
