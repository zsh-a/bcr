import { CACHE, STATE } from '../lib/paths';
import { bytes } from '../maintenance/size';
import { project, workspace } from '../project';
import { releases } from '../release';

export function status(id?: string) {
  const registry = workspace();
  const ids = id ? [id] : registry.projects.map((entry) => entry.id);
  return {
    cache: { path: CACHE, bytes: bytes(CACHE), budgetGiB: registry.cacheBudgetGiB },
    state: STATE,
    projects: ids.map((name) => {
      const current = project(name);
      return {
        id: name,
        role: current.role,
        stage: current.config.stage ?? (current.config.audio ? 'production' : 'prototype'),
        targets: current.work.targets.map((target) => ({
          id: target.id,
          runtime: target.runtime,
          frames: target.durationInFrames,
        })),
        releases: releases(current),
      };
    }),
  };
}

export function printStatus(result: ReturnType<typeof status>) {
  console.table(
    result.projects.map((entry) => ({
      工程: entry.id,
      用途: entry.role,
      阶段: entry.stage,
      目标数: entry.targets.length,
      已登记交付: entry.releases.length,
    })),
  );
  console.log(
    `缓存 ${(result.cache.bytes / 1024 ** 3).toFixed(2)} GiB / ${result.cache.budgetGiB} GiB · ${CACHE}`,
  );
  console.log(`制作记录 ${STATE}`);
}
