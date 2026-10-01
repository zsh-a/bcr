/** A cleanup cannot race a loader, replay, query or streamed export. */
export async function withResearchFiles<T>(
  mode: "shared" | "exclusive",
  work: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks) return work();
  return await navigator.locks.request("bcr:quant:research-files", { mode }, work);
}
