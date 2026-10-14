import { hashFile, inside, json } from '../lib/files';
import type { VoiceSettings } from './content';

interface RecordedGroup {
  id: string;
  text: string;
  hash: string;
  raw: string;
  sourceSha256: string;
}
interface RecordedPlan {
  settings: { model: string; referenceHash: string };
  groups: RecordedGroup[];
}

export function recordedSource(root: string, voice: VoiceSettings) {
  const source = voice.generation?.recordedSource;
  if (!source) {
    return undefined;
  }
  if (!Number.isFinite(source.tempo) || source.tempo < 0.85 || source.tempo > 1.15) {
    throw new Error('已录旁白的保留音高变速范围为 0.85 至 1.15');
  }
  const path = inside(root, source.plan);
  if (hashFile(path) !== source.sha256) {
    throw new Error('已录旁白的来源计划身份发生变化');
  }
  const plan = json<RecordedPlan>(path);
  if (
    plan.settings.model !== voice.model ||
    plan.settings.referenceHash !==
      hashFile(inside(root, voice.referenceFile ?? 'public/audio/reference.wav'))
  ) {
    throw new Error('已录旁白与当前模型或参考声线不一致');
  }
  const ids = new Set<string>();
  for (const group of plan.groups) {
    if (ids.has(group.id) || !/^[a-f0-9]{64}$/.test(group.sourceSha256)) {
      throw new Error(`已录旁白来源无效: ${group.id}`);
    }
    ids.add(group.id);
    group.raw = inside(root, group.raw);
    if (hashFile(group.raw) !== group.sourceSha256) {
      throw new Error(`原始录音身份发生变化: ${group.id}`);
    }
  }
  return { ...source, path, groups: plan.groups };
}
