import { join, relative } from 'node:path';
import { dependencyIdentity } from '../../lib/dependencies';
import { fileMap, hashFile, inside, json, sha, sourceGraph, stable } from '../../lib/files';
import { engineLock, TOOLS } from '../../lib/paths';
import { type Runtime, readRuntime } from '../../pipeline/runtime';
import { assets, type Project, type Target } from '../../project';

export interface SceneDefinition {
  id: string;
  entry: string;
  cues: string[];
  transitionFrames?: number;
}
export interface SceneCatalog {
  version: number;
  transitionFrames: number;
  dissolvingGroups: string[];
  scenes: SceneDefinition[];
  sharedEntries?: string[];
  progress?: { color: string; height: number; endChapter: string };
}
export interface SceneInput extends Runtime {
  incoming?: { runtime: Runtime; frame: number };
}
export interface SceneContract {
  id: string;
  start: number;
  end: number;
  incoming: string | null;
  transitionFrames: number;
  terminalFrame: number;
}
export interface ScenePlan {
  contract: SceneContract;
  input: SceneInput;
  key: string;
  dependencies: Record<string, string>;
}

export function sceneContracts(value: Runtime, catalog: SceneCatalog): SceneContract[] {
  const starts = value.main.segments.filter(
    (segment, index, items) => index === 0 || segment.chapter !== items[index - 1]!.chapter,
  );
  const ids = starts.map((segment) => segment.chapter);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !catalog.scenes.some((scene) => scene.id === id))
  ) {
    throw new Error('章节必须连续且在镜头清单中声明');
  }
  return starts.map((segment, index) => {
    const start = index === 0 ? 0 : segment.start;
    const end = starts[index + 1]?.start ?? value.main.durationInFrames;
    return {
      id: segment.chapter,
      start,
      end,
      incoming: index > 0 ? starts[index - 1]!.chapter : null,
      transitionFrames:
        index === 0
          ? 0
          : (catalog.scenes.find((scene) => scene.id === segment.chapter)?.transitionFrames ??
            catalog.transitionFrames),
      terminalFrame: end - start - 1,
    };
  });
}

export function readCatalog(p: Project): SceneCatalog {
  if (!p.config.scenes) {
    throw new Error('未配置镜头清单');
  }
  const catalog = json<SceneCatalog>(inside(p.root, p.config.scenes.catalog));
  if (
    catalog.version !== 1 ||
    !Array.isArray(catalog.scenes) ||
    !Number.isInteger(catalog.transitionFrames) ||
    catalog.transitionFrames < 0
  ) {
    throw new Error('镜头清单格式不匹配');
  }
  const ids = catalog.scenes.map((scene) => scene.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error('镜头 ID 重复');
  }
  return catalog;
}

export function localRuntime(id: string, value: Runtime, catalog: SceneCatalog): Runtime {
  const contract = sceneContracts(value, catalog).find((scene) => scene.id === id);
  const definition = catalog.scenes.find((scene) => scene.id === id);
  if (!contract || !definition) {
    throw new Error(`找不到镜头: ${id}`);
  }
  const frames: Record<string, number> = {};
  for (const cue of definition.cues) {
    if (!Number.isFinite(value.frames[cue])) {
      throw new Error(`镜头 ${id} 使用了不存在的动作锚点: ${cue}`);
    }
    frames[cue] = value.frames[cue]! - contract.start;
  }
  return {
    draft: value.draft,
    fps: value.fps,
    frames,
    main: {
      durationInFrames: contract.end - contract.start,
      audioFile: '',
      segments: value.main.segments
        .filter((segment) => segment.chapter === id)
        .map((segment) => ({
          ...segment,
          start: segment.start - contract.start,
          end: segment.end - contract.start,
        })),
    },
  };
}

export function sceneInput(id: string, value: Runtime, catalog: SceneCatalog): SceneInput {
  const contract = sceneContracts(value, catalog).find((scene) => scene.id === id)!;
  const input: SceneInput = localRuntime(id, value, catalog);
  if (contract.incoming && contract.transitionFrames) {
    const previous = localRuntime(contract.incoming, value, catalog);
    input.incoming = { runtime: previous, frame: previous.main.durationInFrames - 1 };
  }
  return input;
}

export function planScenes(
  p: Project,
  t: Target,
  environment: unknown,
  value = readRuntime(p),
  overrides: Record<string, string> = {},
): ScenePlan[] {
  const catalog = readCatalog(p);
  const excluded = new Set([
    p.config.runtime!.timing,
    p.config.runtime!.events,
    p.config.scenes!.catalog,
  ]);
  const modules = new Map(
    catalog.scenes.map((scene) => [
      scene.id,
      sourceGraph(p.root, scene.entry)
        .map((file) => relative(p.root, file))
        .filter((file) => !excluded.has(file)),
    ]),
  );
  const common = [
    ...sourceGraph(p.root, t.entry, {
      externalEntries: catalog.scenes.map((scene) => scene.entry),
    }),
    ...(catalog.sharedEntries ?? []).flatMap((entry) => sourceGraph(p.root, entry)),
  ]
    .map((file) => relative(p.root, file))
    .filter((file) => !excluded.has(file));
  const visualAssets = [
    ...new Set([...(t.assets ?? []), ...assets(p, t).map((file) => relative(p.root, file))]),
  ].filter((file) => !/\.(flac|wav|mp3|m4a|ogg|aac)$/i.test(file));
  // Stage-specific producer modules replace source-text marker splitting.
  const producer = fileMap(
    TOOLS,
    [
      'src/video/scenes/frames.ts',
      'src/video/browser.ts',
      'src/video/build.ts',
      'src/lib/dependencies.ts',
      'src/lib/files.ts',
    ].map((file) => join(TOOLS, file)),
  );
  const dependencies = dependencyIdentity(p);
  return sceneContracts(value, catalog).map((contract) => {
    const files = [
      ...new Set([
        ...common,
        ...modules.get(contract.id)!,
        ...(contract.incoming && contract.transitionFrames ? modules.get(contract.incoming)! : []),
        ...visualAssets,
      ]),
    ];
    const hashes = Object.fromEntries(
      files.sort().map((file) => [file, overrides[file] ?? hashFile(inside(p.root, file))]),
    );
    const input = sceneInput(contract.id, value, catalog);
    const key = sha(
      stable({
        files: hashes,
        input,
        producer,
        dependencies,
        geometry: { width: t.width, height: t.height, fps: t.fps },
        definition: catalog.scenes.find((scene) => scene.id === contract.id),
        transitions: { frames: catalog.transitionFrames, groups: catalog.dissolvingGroups },
        environment,
      }),
    );
    return { contract, input, key, dependencies: hashes };
  });
}

export function renderProducerIdentity() {
  return {
    engineLock: hashFile(engineLock()),
    bun: Bun.version,
    platform: process.platform,
    arch: process.arch,
  };
}
