import { AudioWaveform } from "lucide-react";
import type { AppManifest } from "@bcr/shell-contract";

/**
 * Media Studio (Subtitle) — local speech-to-subtitle pipeline.
 *
 * Contributes the BLAKE3 and waveform kernels to the host compute worker; the
 * streaming decode executor stays with the app's own runtime composition.
 */
export const manifest: AppManifest = {
  id: "media",
  title: "Media Studio",
  path: "/media",
  icon: AudioWaveform,
  description: "本地语音转字幕 · Whisper ASR / 双语翻译 / SRT·VTT·ASS 导出",
  section: "compute",
  load: () => import("./App"),
  validateSearch: (search) => ({
    cite: search["cite"],
    source: typeof search["source"] === "string" ? search["source"] : undefined,
    time: typeof search["time"] === "number" ? search["time"] : undefined,
  }),
  compute: {
    module: () => import("./compute"),
    backends: { wasm: ["hash.blake3", "audio.waveform"], js: [] },
  },
};
