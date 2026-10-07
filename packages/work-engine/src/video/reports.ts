export interface ArtifactReport {
  key: string;
  project: string;
  target: string;
  status: string;
  path: string;
  sha256: string;
  input: { key: string };
  scope?: string;
  cached?: boolean;
  frames?: number;
  encoder?: string;
  frameCacheHit?: boolean;
  [detail: string]: unknown;
}

export interface MediaStream {
  codec_type: string;
  codec_name: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  nb_read_frames?: string;
  [detail: string]: unknown;
}

export interface MediaProbe {
  streams: MediaStream[];
  format: { duration: string; [detail: string]: unknown };
}
