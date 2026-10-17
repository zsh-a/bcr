import { existsSync } from 'node:fs';
import { inside, json, sourceGraph } from '../lib/files';
import type { Project, Target } from '../project';

/** A static target only inherits timing if its source actually imports it. */
export function targetScope(p: Project, t: Target) {
  const scenes = !!p.config.scenes && (p.config.scenes.target ?? 'main') === t.id;
  const declaredAudio =
    !!p.config.audio && (t.id === 'main' || !!p.config.targets[t.id]?.audio || scenes);
  let runtime = !!p.config.runtime;
  if (runtime && t.id !== 'main' && !declaredAudio && !scenes && t.durationInFrames === 1) {
    try {
      const files = new Set(sourceGraph(p.root, t.entry));
      if (t.propsFile) {
        files.add(inside(p.root, t.propsFile));
      }
      runtime = [p.config.runtime!.timing, p.config.runtime!.events].some((file) =>
        files.has(inside(p.root, file)),
      );
    } catch {
      // A missing import may be a derived timeline. Preserve the guard on ambiguity.
      runtime = true;
    }
  }
  return { audio: declaredAudio || (runtime && !!p.config.audio), runtime, scenes };
}

/** Timing provenance and compilation freshness are separate questions. */
export function timingStatus(p: Project) {
  const path = p.config.audio?.timeline;
  if (!path) {
    return { mode: 'missing' as const, reason: '未配置时间轴' };
  }
  try {
    const file = inside(p.root, path);
    if (!existsSync(file)) {
      return { mode: 'missing' as const, path, reason: '时间轴尚未生成' };
    }
    const value = json<{ draft?: boolean; main?: { durationInFrames?: number } }>(file);
    if (!Number.isFinite(value.main?.durationInFrames)) {
      return { mode: 'missing' as const, path, reason: '时间轴缺少有效时长' };
    }
    return { mode: value.draft === true ? ('draft' as const) : ('measured' as const), path };
  } catch (error) {
    return {
      mode: 'missing' as const,
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
