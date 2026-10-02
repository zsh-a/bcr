import { definition } from "./app-definition";
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
  backends: { wasm: ["hash.blake3", "audio.waveform"], js: [] },
} as const;

export const manifest = {
  ...definition,
  icon: AudioWaveform,
  load: () => import("./App"),
  validateSearch: (search) => ({
    cite: search["cite"],
    source: typeof search["source"] === "string" ? search["source"] : undefined,
    time: typeof search["time"] === "number" ? search["time"] : undefined,
  }),
  compute: MEDIA_COMPUTE,
} as const satisfies AppManifest;
