import { AudioWaveform } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Media Studio (Subtitle) — local speech-to-subtitle pipeline.
 *
 * Contributes the BLAKE3 and waveform kernels to the host compute worker; the
 * streaming decode executor stays with the app's own runtime composition.
 */
/** Operations this app contributes to the host compute worker. */
const MEDIA_COMPUTE = {
  module: () => import("./compute"),
  backends: { wasm: ["hash.blake3", "audio.waveform"], js: [] },
} as const;

export const manifest = {
  id: "media",
  title: "Media Studio",
  path: "/media",
  icon: AudioWaveform,
  description: "音视频转字幕，校对、翻译与导出",
  section: "tools",
  load: () => import("./App"),
  validateSearch: (search) => ({
    cite: search["cite"],
    source: typeof search["source"] === "string" ? search["source"] : undefined,
    time: typeof search["time"] === "number" ? search["time"] : undefined,
  }),
  compute: MEDIA_COMPUTE,
} as const satisfies AppManifest;
