import { join } from 'node:path';
import { atomicJSON, inside, json } from '../lib/files';
import { prepareRuntime } from '../pipeline/runtime';
import type { Project, Work } from '../project';
import { draftTimeline, readContent } from './content';

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
  prepareRuntime(p);
  return { project: p.id, draft: true, durationInFrames: target.durationInFrames };
}
