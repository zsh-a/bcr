import { join } from 'node:path';
import { dependencyIdentity } from '../lib/dependencies';
import { fileMap, hashFile, sha, stable } from '../lib/files';
import { TOOLS } from '../lib/paths';
import { readRuntime } from '../pipeline/runtime';
import { type Project, type Target, targetIdentity } from '../project';
import { planScenes, readCatalog } from './scenes/plan';

/** Rendering dependencies are distinct from the complete source audit identity. */
export function renderIdentity(
  p: Project,
  t: Target,
  pixelsOnly = false,
  mode?: 'scenes' | 'frames' | 'player',
) {
  if (
    !pixelsOnly &&
    mode !== 'frames' &&
    mode !== 'player' &&
    p.config.scenes &&
    (p.config.scenes.target ?? 'main') === t.id
  ) {
    const scenes = planScenes(p, t, {});
    const audio = `public/${p.config.targets[t.id]?.audio ?? readRuntime(p).main.audioFile}`;
    const files = Object.assign({}, ...scenes.map((scene) => scene.dependencies), {
      [audio]: hashFile(join(p.root, audio)),
    }) as Record<string, string>;
    const producer = { compose: videoProducer() };
    return {
      key: sha(
        stable({
          scenes: scenes.map((scene) => scene.key),
          audio: files[audio],
          progress: readCatalog(p).progress ?? p.config.scenes.progress,
          producer,
        }),
      ),
      files,
      producer,
    };
  }
  const audit = targetIdentity(p, t);
  const files = Object.fromEntries(
    Object.entries(audit.files).filter(
      ([path]) =>
        path !== 'package.json' && (!pixelsOnly || !/\.(flac|wav|mp3|m4a|ogg|aac)$/i.test(path)),
    ),
  );
  const producer = fileMap(
    TOOLS,
    [
      'src/video/build.ts',
      'src/video/browser.ts',
      'src/video/render.ts',
      'src/video/scenes/frames.ts',
      'src/video/scenes/compose.ts',
      'src/video/props.ts',
      ...(p.config.targets[t.id]?.renderer === 'player'
        ? [
            'src/video/player-frames.ts',
            'src/video/preview.ts',
            'src/video/player.tsx',
            'src/video/bridge.ts',
            'src/video/review.ts',
          ]
        : []),
      'src/lib/dependencies.ts',
    ].map((path) => join(TOOLS, path)),
  );
  return {
    key: sha(
      stable({
        files,
        dependencies: dependencyIdentity(p),
        target: t,
        policy: p.config.targets[t.id],
        webgl: p.config.webgl,
        scenes: pixelsOnly ? undefined : p.config.scenes,
        producer,
        bun: Bun.version,
        platform: process.platform,
        arch: process.arch,
      }),
    ),
    files,
    producer,
  };
}

export const videoProducer = () => hashFile(join(TOOLS, 'src/video/scenes/compose.ts'));
