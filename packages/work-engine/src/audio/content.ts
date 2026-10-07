import { join } from 'node:path';
import { atomicJSON, inside, json, sha, stable } from '../lib/files';
import type { Project, Work } from '../project';

export interface NarrationLine {
  id: string;
  chapter: string;
  text: string;
  caption: string;
}

export interface Paragraph {
  id: string;
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
  referenceTranscript: string;
  language: string;
  endpoint: string;
  model: string;
  mastering: { loudnessLUFS: number; truePeakDBTP: number };
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

export function writeDraft(p: Project, force = false) {
  if (p.config.audio?.driver !== 'standard') {
    throw new Error('draft 用于 init 创建的标准工程；已有作品沿用本期的草稿脚本');
  }
  const path = inside(p.root, p.config.audio.timeline);
  const previous = json<{ draft?: boolean }>(path);
  if (!previous.draft && !force) {
    throw new Error('已存在实测时间轴；如需回到草稿请明确使用 draft --force');
  }
  const work = json<Work>(join(p.root, 'work.json'));
  const target = work.targets.find((t) => t.id === 'main');
  if (!target?.fps) {
    throw new Error('缺少 main 目标或 fps');
  }
  const timeline = draftTimeline(readContent(p), target.fps);
  target.durationInFrames = timeline.main.durationInFrames;
  atomicJSON(path, timeline);
  atomicJSON(join(p.root, 'work.json'), work);
  atomicJSON(join(p.root, 'production.json'), { ...p.config, stage: 'draft' });
  return { project: p.id, draft: true, durationInFrames: target.durationInFrames };
}
