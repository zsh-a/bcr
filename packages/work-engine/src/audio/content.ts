import { inside, json, sha, stable } from '../lib/files';
import type { Project } from '../project';

export interface NarrationLine {
  id: string;
  chapter: string;
  text: string;
  caption: string;
}

export interface Paragraph {
  id: string;
  /** Optional editorial role of the idea unit, e.g. question, explain, conclude. */
  role?: string;
  gapAfter: number;
  holdReason?: string;
  lines: NarrationLine[];
}

export interface Content {
  title: string;
  subtitle: string;
  paragraphs: Paragraph[];
}

export interface VoiceSettings {
  referenceFile?: string;
  backend: 'audio.cpp' | 'drama-rs';
  referenceTranscript: string;
  language: string;
  endpoint?: string;
  model: string;
  modelRevision?: string;
  runtimeRevision?: string;
  generation?: {
    recordedSource?: {
      plan: string;
      sha256: string;
      tempo: number;
      onTextChange?: 'generate' | 'error';
    };
    options?: Record<string, string | number | boolean | number[]>;
    emotionReference?: string;
    /** drama-rs delivery tag prefixed to each paragraph without its own tag. */
    styleTag?: string;
    paragraphs?: Record<
      string,
      {
        text?: string;
        emotionReference?: string;
        options?: Record<string, string | number | boolean | number[]>;
      }
    >;
  };
  alignment?: {
    model?: string;
    modelRevision?: string;
    options?: Record<string, string | number | boolean | number[]>;
  };
  mastering: { loudnessLUFS: number; truePeakDBTP: number };
  /** Optional original score rendered by the Work and ducked under the narration. */
  music?: {
    script: string;
    inputs?: string[];
    bedBelowVoiceLU: number;
    duck: { threshold: number; ratio: number; attackMs: number; releaseMs: number };
    minVoiceToMusicDb: number;
  };
  quality: {
    maxCaptionWidth: number;
    maxCaptionCharactersPerSecond: number;
    maxParagraphGapSeconds: number;
    maxInternalSilenceSeconds: number;
    maxCharactersPerMinute: number;
  };
}

export function validateContent(content: Content) {
  if (!content.title?.trim() || !content.paragraphs?.length) {
    throw new Error('content.json 需要标题和至少一个语义段落');
  }
  const ids = new Set<string>();
  const addId = (id: string) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || ids.has(id)) {
      throw new Error(`语义 ID 无效或重复: ${id}`);
    }
    ids.add(id);
  };
  for (const paragraph of content.paragraphs) {
    addId(paragraph.id);
    if (!Number.isFinite(paragraph.gapAfter) || paragraph.gapAfter < 0) {
      throw new Error(`段落停顿无效: ${paragraph.id}`);
    }
    if (paragraph.gapAfter > 0.26 && !paragraph.holdReason?.trim()) {
      throw new Error(`长停顿需要 holdReason: ${paragraph.id}`);
    }
    if (!paragraph.lines?.length) {
      throw new Error(`段落缺少字幕行: ${paragraph.id}`);
    }
    for (const line of paragraph.lines) {
      addId(line.id);
      if (!line.text?.trim() || !line.caption?.trim() || !line.chapter?.trim()) {
        throw new Error(`字幕行需要 text、caption 和 chapter: ${line.id}`);
      }
    }
  }
}

export function readContent(p: Project) {
  const path = p.config.audio?.content ?? 'content.json';
  const content = json<Content>(inside(p.root, path));
  validateContent(content);
  return content;
}

export const contentHash = (content: Content) => sha(stable(content));

export function draftTimeline(content: Content, fps: number) {
  validateContent(content);
  let seconds = 0.32;
  const segments = content.paragraphs.flatMap((paragraph, index) => {
    const lines = paragraph.lines.map((line) => {
      const speechStart = seconds;
      seconds += Math.max(1.1, [...line.text].length / 4.8);
      return {
        ...line,
        group: paragraph.id,
        speechStart,
        speechEnd: seconds,
        start: Math.floor(speechStart * fps),
        end: Math.ceil(seconds * fps),
      };
    });
    if (index < content.paragraphs.length - 1) {
      seconds += paragraph.gapAfter;
    }
    return lines;
  });
  for (let index = 0; index < segments.length - 1; index++) {
    const segment = segments[index]!;
    segment.end = Math.min(segment.end, segments[index + 1]!.start);
  }
  const durationInFrames = Math.ceil((seconds + 1.8) * fps);
  return {
    version: 0,
    draft: true,
    contentHash: contentHash(content),
    fps,
    sampleRate: 48000,
    main: {
      durationInFrames,
      audioFile: 'audio/mix-main.flac',
      narrationFile: 'narration-main.wav',
      samples: Math.round((durationInFrames / fps) * 48000),
      segments,
    },
  };
}
