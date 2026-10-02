import { OpfsStore } from "@bcr/storage-opfs";

/** Shared immutable market archives. The name preserves existing locally stored snapshots. */
export const RESEARCH_NAMESPACE = "quant";
export const marketResearchStore = () => new OpfsStore(RESEARCH_NAMESPACE);
