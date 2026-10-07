import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  pageReviewScript,
  type RenderRequest,
  renderSettings,
  type Project as SourceProject,
} from '@bcr/work-core';
import { atomicJSON, hashFile, inside, sha } from './lib/files';
import { TOOLS } from './lib/paths';
import { gc } from './maintenance/cache';
import { assets, loadProject } from './project';
import { capture } from './video/capture';
import { writePreview } from './video/preview';
import { render } from './video/render';

export interface ExecutionContext {
  directory: string;
  source: string;
  project: SourceProject;
  request: RenderRequest;
  signal: AbortSignal;
  report: (progress: number, stage: string) => void;
}

/** Execute an immutable snapshot with the same engine and cache policy used by the CLI. */
export async function execute(context: ExecutionContext) {
  const { source, directory, project, request, signal, report } = context;
  signal.throwIfAborted();
  for (const file of project.files) {
    if (hashFile(inside(source, file.path)) !== file.hash) {
      throw new Error(`快照校验失败：${file.path}`);
    }
  }
  const current = loadProject(source);
  const target = project.targets.find((item) => item.id === request.target);
  if (!target) {
    throw new Error('目标不存在');
  }
  const outputs = join(directory, 'outputs');
  const site = join(directory, 'site');
  mkdirSync(outputs, { recursive: true });
  try {
    if (request.kind === 'archive') {
      const files: Record<string, Uint8Array> = Object.create(null);
      for (const file of project.files) {
        files[file.path] = new Uint8Array(readFileSync(inside(source, file.path)));
      }
      files['bcr-snapshot.json'] = new TextEncoder().encode(
        JSON.stringify({ project, engine: '4.0.532' }),
      );
      await Bun.write(join(outputs, 'source.tar.gz'), new Bun.Archive(files, { compress: 'gzip' }));
      return;
    }
    if (target.runtime === 'html') {
      if (!['preview', 'validate'].includes(request.kind)) {
        throw new Error('HTML 目标仅支持预览、验证与源码归档');
      }
      if (!/\.html?$/iu.test(target.entry)) {
        throw new Error('HTML 目标入口必须是 HTML 文件');
      }
      if (request.kind === 'preview') {
        mkdirSync(site, { recursive: true });
        const permitted = new Set(assets(current, target));
        const manifest: Record<string, string> = {};
        for (const file of project.files) {
          if (file.path.startsWith('public/')) {
            if (permitted.has(inside(source, file.path))) {
              manifest[file.path] = file.hash;
            }
            continue;
          }
          const destination = inside(site, file.path);
          mkdirSync(dirname(destination), { recursive: true });
          let bytes = readFileSync(inside(source, file.path));
          if (/\.html?$/iu.test(file.path)) {
            const script = `${'../'.repeat(file.path.split('/').length - 1)}bcr-preview.js`;
            bytes = Buffer.from(
              `${bytes.toString('utf8')}\n<script src=${JSON.stringify(script)}></script>`,
            );
          }
          writeFileSync(destination, bytes);
          manifest[file.path] = sha(bytes);
        }
        const entry = join(TOOLS, `.preview-${crypto.randomUUID()}.ts`);
        try {
          writeFileSync(
            entry,
            `import {connectPreview} from './src/video/bridge';\n${pageReviewScript}\nconnectPreview();`,
          );
          const built = await Bun.build({ entrypoints: [entry], target: 'browser', minify: true });
          if (!built.success || !built.outputs[0]) {
            throw new Error(built.logs.join('\n'));
          }
          await Bun.write(join(site, 'bcr-preview.js'), built.outputs[0]);
        } finally {
          rmSync(entry, { force: true });
        }
        manifest['bcr-preview.js'] = hashFile(join(site, 'bcr-preview.js'));
        atomicJSON(join(outputs, 'page-manifest.json'), manifest);
        atomicJSON(
          join(site, 'assets.json'),
          Object.fromEntries(
            Object.entries(manifest).filter(([path]) => path.startsWith('public/')),
          ),
        );
      }
      report(1, 'HTML 就绪');
      return;
    }
    const settings = renderSettings(request);
    if (settings.gl !== null) {
      current.config.webgl = settings.gl === 'angle';
    }
    if (request.kind === 'preview') {
      report(0.1, '构建共享播放器');
      atomicJSON(join(site, 'assets.json'), await writePreview(current, target, site, signal));
      report(1, '播放器就绪');
      return;
    }
    const diagnostics = diagnose(project, target, request);
    if (diagnostics.errors.length) {
      throw new Error(diagnostics.errors.join('\n'));
    }
    if (request.kind === 'capture' || request.kind === 'validate') {
      const frames = request.kind === 'validate' ? [0] : (request.frames ?? [0]);
      for (const [index, frame] of frames.entries()) {
        signal.throwIfAborted();
        await capture(current, target, frame, join(outputs, `frame-${frame}.png`), {
          scale: settings.scale,
          signal,
        });
        report((index + 1) / frames.length, `关键帧 ${frame}`);
      }
      if (request.kind === 'validate') {
        atomicJSON(join(outputs, 'diagnostics.json'), {
          ...diagnostics,
          checkedFrames: frames,
          note: '指定帧自动检查；完整播放、听审与平台验收仍需完成。',
        });
      }
    } else if (request.kind === 'video') {
      await render(current, target, {
        from: request.from,
        to: request.to,
        scale: settings.scale,
        encoder: settings.encoder,
        cq: settings.cq,
        cpuReason: settings.cpuReason ?? undefined,
        concurrency: current.config.webgl ? 1 : 2,
        signal,
        onProgress: report,
        output: join(outputs, 'video.mp4'),
      });
    }
    report(1, '完成');
  } finally {
    try {
      await gc(true, undefined, 0);
    } catch (error) {
      console.error(`缓存回收延后：${String(error)}`);
    }
  }
}

export function diagnose(
  project: SourceProject,
  target: SourceProject['targets'][number],
  request: RenderRequest,
) {
  const required = target.runtime === 'remotion' ? (target.assets ?? []) : [];
  const assets = project.files.filter(
    (file) => file.path.startsWith('public/') || required.includes(file.path),
  );
  const errors = [...new Set(required)].flatMap((path) => {
    const file = project.files.find((item) => item.path === path);
    return !file ? [`缺少声明的素材：${path}`] : !file.size ? [`素材为空：${path}`] : [];
  });
  const fonts = assets.filter((file) => /\.(woff2?|otf|ttf)$/iu.test(file.path));
  return {
    sourceRevision: project.revision,
    target: target.id,
    settings: target.runtime === 'remotion' ? renderSettings(request) : null,
    assets,
    fonts: fonts.map((file) => file.path),
    errors,
    warnings:
      target.runtime === 'remotion' && !fonts.length
        ? ['未发现本地字体，请检查系统字体或外部字体是否一致。']
        : [],
  };
}
