import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { audioStageStatus } from '../audio';
import { CACHE } from '../lib/paths';
import { command } from '../lib/process';
import { type Project, type Target, targetIdentity } from '../project';
import { browser } from '../video/browser';
import { planScenes } from '../video/scenes/plan';
import { runtimeStatus } from './runtime';
import { validationStatus } from './validation';

export async function productionPlan(p: Project, t: Target) {
  const runtime = runtimeStatus(p);
  const audio = audioStageStatus(p);
  const validation = validationStatus(p, t);
  const hasScenes = p.config.scenes && (p.config.scenes.target ?? 'main') === t.id && runtime.fresh;
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
    audio.some((stage) => !stage.fresh) ? 'audio' : undefined,
    !runtime.fresh ? 'prepare' : undefined,
    !validation.fresh ? 'qa' : undefined,
  ].filter((item): item is string => !!item);
  return {
    project: p.id,
    target: t.id,
    input: targetIdentity(p, t),
    runtime,
    audio,
    validation: { ...validation, report: undefined },
    scenes,
    next: pending,
    policy: 'Scene cache presence is a planning hint; actual rendering verifies cached hashes.',
  };
}
