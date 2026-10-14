import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, readContent } from '../audio/content';
import { atomicJSON, fileMap, hashFile, inside, json, sha, stable, verifyMap } from '../lib/files';
import type { Project } from '../project';

export interface Segment {
  id: string;
  group: string;
  chapter: string;
  caption: string;
  start: number;
  end: number;
}
export interface Runtime {
  draft: boolean;
  contentHash?: string;
  fps: number;
  frames: Record<string, number>;
  main: { durationInFrames: number; audioFile: string; segments: Segment[] };
}
interface Cue {
  id: string;
  group: string;
  phrase: string;
  occurrence?: number;
}
interface Timeline {
  draft?: boolean;
  contentHash: string;
  fps: number;
  sampleRate: number;
  main: Runtime['main'] & {
    groups?: { id: string; startSample: number; trimStart: number; rawSha256: string }[];
  };
}
interface Alignment {
  audioSha256: string;
  words: { text: string; start: number; end: number }[];
}
interface RuntimeManifest {
  key: string;
  inputs: Record<string, string>;
  outputs: Record<string, string>;
}
const clean = (text: string) => text.replace(/[^\p{L}\p{N}]/gu, '');
const manifestPath = (p: Project) => join(p.root, '.bcr/build/runtime/manifest.json');

function inputs(p: Project) {
  const config = p.config.runtime;
  const audio = p.config.audio;
  if (!config || !audio) {
    throw new Error('没有配置 runtime 或 audio');
  }
  const timeline = json<Timeline>(inside(p.root, audio.timeline));
  if (timeline.contentHash !== contentHash(readContent(p))) {
    throw new Error('口播已修改，请先执行 audio');
  }
  const cues = json<{ version: number; cues: Cue[] }>(inside(p.root, config.cues));
  if (cues.version !== 1) {
    throw new Error('动作锚点格式不匹配');
  }
  const ids = new Set<string>();
  const files = [config.cues, audio.timeline, audio.content ?? 'content.json'];
  const alignments = new Map<string, { path: string; value: Alignment }>();
  const plan = !timeline.draft
    ? json<{ groups: { id: string; raw: string; alignment?: string }[] }>(
        inside(p.root, audio.plan),
      )
    : undefined;
  if (plan) {
    files.push(audio.plan);
  }
  for (const cue of cues.cues) {
    if (!cue.id || !cue.phrase || ids.has(cue.id)) {
      throw new Error(`动作锚点无效或重复: ${cue.id}`);
    }
    ids.add(cue.id);
    if (!timeline.draft && !alignments.has(cue.group)) {
      const group = plan?.groups.find((item) => item.id === cue.group);
      if (!group) {
        throw new Error(`找不到配音段落: ${cue.group}`);
      }
      const path = group.alignment ?? group.raw.replace(/\.wav$/, '.alignment.json');
      files.push(path);
      alignments.set(cue.group, { path, value: json<Alignment>(inside(p.root, path)) });
    }
  }
  const hashes = fileMap(
    p.root,
    files.map((file) => inside(p.root, file)),
  );
  const key = sha(stable({ inputs: hashes, compiler: hashFile(import.meta.filename) }));
  return { config, timeline, cues: cues.cues, alignments, hashes, key };
}

export function runtimeStatus(p: Project) {
  if (!p.config.runtime) {
    return { configured: false, fresh: true };
  }
  try {
    const current = inputs(p);
    const previous = existsSync(manifestPath(p))
      ? json<RuntimeManifest>(manifestPath(p))
      : undefined;
    const fresh = previous?.key === current.key && verifyMap(p.root, previous.outputs);
    return {
      configured: true,
      fresh,
      key: current.key,
      reason: fresh ? undefined : '画面时序需要派生',
    };
  } catch (error) {
    return {
      configured: true,
      fresh: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function assertRuntime(p: Project) {
  const status = runtimeStatus(p);
  if (!status.fresh) {
    throw new Error(status.reason);
  }
}

export function prepareRuntime(p: Project) {
  if (!p.config.runtime) {
    return { configured: false, cached: true };
  }
  if (p.frozen) {
    if (
      !existsSync(inside(p.root, p.config.runtime.timing)) ||
      !existsSync(inside(p.root, p.config.runtime.events))
    ) {
      throw new Error('源码快照缺少已派生时序');
    }
    if (!existsSync(manifestPath(p))) {
      throw new Error('源码快照缺少时序编译证明');
    }
    const proof = json<RuntimeManifest>(manifestPath(p));
    if (!verifyMap(p.root, proof.outputs)) {
      throw new Error('源码快照的派生时序身份不符');
    }
    for (const [path, hash] of Object.entries(proof.inputs)) {
      const source = inside(p.root, path);
      if (existsSync(source) && hashFile(source) !== hash) {
        throw new Error(`源码快照输入已变化，请重新派生时序: ${path}`);
      }
    }
    return { configured: true, cached: true, frozen: true };
  }
  const value = inputs(p);
  if (existsSync(manifestPath(p))) {
    const previous = json<RuntimeManifest>(manifestPath(p));
    if (previous.key === value.key && verifyMap(p.root, previous.outputs)) {
      return { configured: true, cached: true, key: value.key };
    }
  }
  const { timeline, cues, alignments, config } = value;
  const frames: Record<string, number> = {};
  const provenance: Record<string, unknown> = {};
  for (const cue of cues) {
    if (timeline.draft) {
      const paragraph = readContent(p).paragraphs.find((item) => item.id === cue.group);
      const line = paragraph?.lines.find((item) => item.text.includes(cue.phrase));
      const segment = timeline.main.segments.find((item) => item.id === line?.id);
      if (!segment) {
        throw new Error(`找不到草稿动作锚点: ${cue.id}`);
      }
      frames[cue.id] = segment.start;
      continue;
    }
    const alignment = alignments.get(cue.group)!;
    const edit = timeline.main.groups?.find((item) => item.id === cue.group);
    if (!edit || alignment.value.audioSha256 !== edit.rawSha256) {
      throw new Error(`对齐身份过期: ${cue.group}`);
    }
    const text = alignment.value.words.map((word) => clean(word.text)).join('');
    const phrase = clean(cue.phrase);
    const matches = [
      ...text.matchAll(new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')),
    ];
    const match = matches[(cue.occurrence ?? 1) - 1];
    if (!match || (matches.length > 1 && cue.occurrence === undefined)) {
      throw new Error(`动作短语缺失或不唯一，请指定 occurrence: ${cue.id}`);
    }
    let offset = 0;
    const word = alignment.value.words.find((item) => {
      const before = offset;
      offset += clean(item.text).length;
      return before <= match.index! && offset > match.index!;
    });
    if (!word) {
      throw new Error(`找不到对齐词: ${cue.id}`);
    }
    const sample =
      edit.startSample + Math.round((word.start - edit.trimStart) * timeline.sampleRate);
    frames[cue.id] = Math.ceil((sample * timeline.fps) / timeline.sampleRate);
    provenance[cue.id] = {
      group: cue.group,
      phrase: cue.phrase,
      audioSha256: alignment.value.audioSha256,
      alignmentSha256: hashFile(inside(p.root, alignment.path)),
    };
  }
  const timing = {
    draft: timeline.draft === true,
    contentHash: timeline.contentHash,
    fps: timeline.fps,
    main: {
      durationInFrames: timeline.main.durationInFrames,
      audioFile: timeline.main.audioFile,
      segments: timeline.main.segments.map(({ id, group, chapter, caption, start, end }) => ({
        id,
        group,
        chapter,
        caption,
        start,
        end,
      })),
    },
  };
  atomicJSON(inside(p.root, config.timing), timing);
  atomicJSON(inside(p.root, config.events), {
    schemaVersion: 1,
    draft: timing.draft,
    contentHash: timing.contentHash,
    frames,
    provenance,
  });
  atomicJSON(manifestPath(p), {
    key: value.key,
    inputs: value.hashes,
    outputs: fileMap(p.root, [inside(p.root, config.timing), inside(p.root, config.events)]),
  });
  return { configured: true, cached: false, key: value.key, events: cues.length };
}

export function readRuntime(p: Project): Runtime {
  const config = p.config.runtime;
  if (!config) {
    throw new Error('镜头渲染需要 runtime 配置');
  }
  return {
    ...json<Omit<Runtime, 'frames'>>(inside(p.root, config.timing)),
    frames: json<{ frames: Runtime['frames'] }>(inside(p.root, config.events)).frames,
  };
}
