export interface AudioTrack {
  audioFile: string;
  narrationFile: string;
  durationInFrames: number;
}

export interface AudioTimeline {
  fps: number;
  sampleRate: number;
  draft?: boolean;
  contentHash?: string;
  [target: string]: unknown;
}

export function isAudioTrack(value: unknown): value is AudioTrack {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const track = value as Partial<AudioTrack>;
  return typeof track.audioFile === 'string' && typeof track.durationInFrames === 'number';
}
