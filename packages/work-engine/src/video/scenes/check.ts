import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderStill, selectComposition } from '@remotion/renderer';
import { atomicJSON, stable } from '../../lib/files';
import { prepareRuntime, readRuntime } from '../../pipeline/runtime';
import type { Project, Target } from '../../project';
import { locked } from '../../state/lock';
import { browser } from '../browser';
import { build } from '../build';
import { decodedRGB } from './frames';
import { planScenes } from './plan';

export async function checkScenes(
  p: Project,
  t: Target,
  options: {
    logicOnly?: boolean | undefined;
    directory?: string | undefined;
    baselineDirectory?: string | undefined;
  } = {},
) {
  prepareRuntime(p);
  const runtime = readRuntime(p);
  const environment = { test: true };
  const original = planScenes(p, t, environment, runtime);
  const shifted = structuredClone(runtime);
  for (const segment of shifted.main.segments) {
    segment.start += 90;
    segment.end += 90;
  }
  for (const id of Object.keys(shifted.frames)) {
    shifted.frames[id] = shifted.frames[id]! + 90;
  }
  shifted.main.durationInFrames += 90;
  const changed = planScenes(p, t, environment, shifted);
  for (let index = 2; index < original.length; index++) {
    if (original[index]!.key !== changed[index]!.key) {
      throw new Error(`绝对时间平移导致局部镜头失效: ${original[index]!.contract.id}`);
    }
  }
  if (options.logicOnly) {
    return {
      status: 'passed',
      shiftedLaterScenesPreserved: true,
      scenes: original.map((item) => item.contract.id),
    };
  }
  return locked(`render:${p.id}`, () =>
    locked('shared-gpu', async () => {
      const bundle = await build(p, t);
      const br = await browser(p);
      const directory =
        options.directory ?? join(p.root, '.bcr/reports', bundle.identity.key, 'scenes');
      mkdirSync(directory, { recursive: true });
      const global = await selectComposition({
        serveUrl: bundle.dir,
        id: 'Managed',
        inputProps: { hideProgress: true },
        ...br.options,
        logLevel: 'error',
      });
      const comparisons = [];
      for (const item of original) {
        const local = await selectComposition({
          serveUrl: bundle.dir,
          id: 'Managed',
          inputProps: { scene: item.input },
          ...br.options,
          logLevel: 'error',
        });
        for (const frame of [
          ...new Set([
            0,
            Math.min(9, item.input.main.durationInFrames - 1),
            Math.min(30, item.input.main.durationInFrames - 1),
            item.input.main.durationInFrames - 1,
          ]),
        ]) {
          const globalPath = join(directory, `${item.contract.id}-${frame}-global.png`);
          const localPath = join(directory, `${item.contract.id}-${frame}-local.png`);
          await renderStill({
            serveUrl: bundle.dir,
            composition: global,
            inputProps: { hideProgress: true },
            frame: item.contract.start + frame,
            output: globalPath,
            imageFormat: 'png',
            ...br.options,
            logLevel: 'error',
          });
          await renderStill({
            serveUrl: bundle.dir,
            composition: { ...local, durationInFrames: item.input.main.durationInFrames },
            inputProps: { scene: item.input },
            frame,
            output: localPath,
            imageFormat: 'png',
            ...br.options,
            logLevel: 'error',
          });
          const actual = await decodedRGB(globalPath, [0]);
          if (!actual.equals(await decodedRGB(localPath, [0]))) {
            throw new Error(`局部与整片画面不一致: ${item.contract.id}/${frame}`);
          }
          if (
            options.baselineDirectory &&
            !actual.equals(
              await decodedRGB(
                join(options.baselineDirectory, `${item.contract.id}-${frame}-global.png`),
                [0],
              ),
            )
          ) {
            throw new Error(`重构前后画面不一致: ${item.contract.id}/${frame}`);
          }
          comparisons.push({
            scene: item.contract.id,
            localFrame: frame,
            globalFrame: item.contract.start + frame,
            rgbEqual: true,
            baselineEqual: options.baselineDirectory ? true : undefined,
          });
        }
        console.log(`scene equivalence: ${item.contract.id}`);
      }
      if (
        stable(planScenes(p, t, environment).map((item) => item.key)) !==
        stable(original.map((item) => item.key))
      ) {
        throw new Error('镜头检查期间输入变化');
      }
      const report = {
        status: 'passed',
        input: bundle.identity,
        comparisons,
        shiftedLaterScenesPreserved: true,
        browser: br.identity,
        continuousHumanReview: 'pending',
      };
      atomicJSON(join(directory, 'scene-check.json'), report);
      return report;
    }),
  );
}
