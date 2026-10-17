import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { audioStageStatus } from '../audio';
import { requireVoice } from '../audio/standard';
import { CACHE } from '../lib/paths';
import { command } from '../lib/process';
import { type Project, type Target, targetIdentity } from '../project';
import { reviewStatus } from '../review';
import { browser } from '../video/browser';
import { planScenes } from '../video/scenes/plan';
import { runtimeStatus } from './runtime';
import { targetScope, timingStatus } from './scope';
import { validationStatus } from './validation';

export async function productionPlan(p: Project, t: Target) {
  const scope = targetScope(p, t);
  const timing = timingStatus(p);
  const runtime = scope.runtime ? runtimeStatus(p) : { configured: false, fresh: true };
  const audio = scope.audio ? audioStageStatus(p) : [];
  const validation = validationStatus(p, t);
  const hasScenes = scope.scenes && runtime.fresh;
  const environment = hasScenes
    ? {
        browser: (await browser(p)).identity,
        ffmpegVersion: (await command(['ffmpeg', '-version'], p.root, {}, true)).split('\n')[0],
        imageFormat: 'png',
        lossless: 'ffv1-bgr0-v2',
      }
    : undefined;
  const scenes = hasScenes
    ? planScenes(p, t, environment).map((item) => ({
        id: item.contract.id,
        key: item.key,
        range: [item.contract.start, item.contract.end],
        incoming: item.contract.incoming,
        cachePresent: existsSync(join(CACHE, `scene-${item.key}`, 'scene.mkv')),
        dependencies: Object.keys(item.dependencies),
      }))
    : [];
  const pending = [
    scope.audio && (timing.mode !== 'measured' || audio.some((stage) => !stage.fresh))
      ? 'audio'
      : undefined,
    scope.runtime && !runtime.fresh ? 'prepare' : undefined,
    !validation.fresh ? 'qa' : undefined,
  ].filter((item): item is string => !!item);
  const blockers: { code: string; message: string; action: string }[] = [];
  if (scope.audio && p.config.audio?.driver === 'standard') {
    try {
      requireVoice(p);
    } catch (error) {
      blockers.push({
        code: 'audio-inputs',
        message: error instanceof Error ? error.message : String(error),
        action: '配置已获使用授权的参考声音与转写，并确认 content.json，再执行 audio',
      });
    }
  }
  if (
    (scope.audio || scope.runtime) &&
    (p.config.stage === 'draft' || timing.mode !== 'measured')
  ) {
    blockers.push({
      code: 'draft-timing',
      message: '草稿或缺失时序不能用于正式音画交付、章节起点',
      action: '完成正式音频与强制对齐，再检查时序和连续音画',
    });
  }
  return {
    project: p.id,
    target: t.id,
    stage: p.config.stage ?? 'unspecified',
    timing,
    scope,
    blockers,
    reviews: reviewStatus(p, t),
    input: targetIdentity(p, t),
    runtime,
    audio,
    validation: { ...validation, report: undefined },
    scenes,
    next: pending,
    readiness: {
      finalVisuals: 'not-assessed',
      authoritativeNotes: 'docs/STATUS.md',
      humanReview: 'not-assessed',
    },
    policy:
      'Technical freshness and model/structure checks do not establish final visual readiness. Read Work status and storyboard; continuous audio/visual review remains required. Scene cache presence is a hint; rendering verifies hashes.',
  };
}
