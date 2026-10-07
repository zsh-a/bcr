#!/usr/bin/env bun
import { audio, ensureAudio } from './audio';
import { writeDraft } from './audio/content';
import { parseCli } from './cli/args';
import { check, doctor } from './cli/diagnostics';
import { help } from './cli/help';
import { printStatus, status } from './cli/status';
import { initProject } from './init';
import { cleanScratch, dedupSnapshots, gc, verifyBaseline } from './maintenance';
import { project, targetOf, workspace } from './project';
import { registerHistory, release, releases } from './release';
import { build, capture, preview, render } from './render';
import { locked } from './state/lock';

const { positionals, values } = parseCli();
const [action = 'help', id] = positionals;
const emit = console.log.bind(console);
if (values.json) {
  console.log = (...args: unknown[]) => console.error(...args);
}
const print = (value: unknown) => emit(JSON.stringify(value, null, 2));

function number(key: keyof typeof values) {
  const value = values[key];
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${key} 需要有效数字`);
  }
  return parsed;
}

interface Artifact {
  project: string;
  target: string;
  status: string;
  path: string;
  cached?: boolean;
  scope?: string;
  frames?: number;
  encoder?: string;
  frameCacheHit?: boolean;
}

function printArtifact(result: Artifact) {
  if (values.json) {
    return print(result);
  }
  emit(
    `${result.project}/${result.target}: ${result.status}${result.cached ? ' (cache hit)' : ''}`,
  );
  if (result.scope) {
    emit(
      `${result.scope} · ${result.frames} frames · ${result.encoder} · frame cache ${result.frameCacheHit ? 'hit' : 'miss'}`,
    );
  }
  emit(result.path);
  emit(`记录 ${result.path}.json`);
}

async function collectCache() {
  if (!['build', 'capture', 'render', 'preview'].includes(action)) {
    return;
  }
  try {
    const report = await gc(true, undefined, 0);
    if (report.removed) {
      console.log(`cache budget: removed ${report.removed} entries`);
    }
  } catch (error) {
    // Maintenance may be deferred without changing the successful artifact result.
    console.error(
      `cache collection deferred: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main() {
  if (values.help || action === 'help') {
    return emit(help);
  }
  switch (action) {
    case 'doctor':
      return print(await doctor(id));
    case 'env':
      return print({ python: await ensureAudio() });
    case 'verify-history': {
      const report = verifyBaseline();
      print(report);
      if (!report.unchanged) {
        process.exitCode = 1;
      }
      return;
    }
    case 'import-history':
      return print(workspace().projects.map((entry) => registerHistory(project(entry.id))));
    case 'status': {
      const result = status(id);
      return values.json ? print(result) : printStatus(result);
    }
    case 'gc': {
      if (values['legacy-scratch'] && values['dedup-snapshots']) {
        throw new Error('每次选择一种清理方式');
      }
      const report = values['legacy-scratch']
        ? await cleanScratch(!!values.apply)
        : values['dedup-snapshots']
          ? await dedupSnapshots(!!values.apply)
          : await gc(!!values.apply, number('budget-gib'));
      return print(
        values.json ? report : { ...report, items: undefined, substitutions: undefined },
      );
    }
    case 'init': {
      if (!id) {
        throw new Error('用法: bcr-work init 工程ID [--title 标题]');
      }
      const result = await initProject(id, { title: values.title, install: !values['no-install'] });
      if (values.json) {
        return print(result);
      }
      emit(`已创建 ${result.project}：${result.path}`);
      emit(`下一步：填写 docs/brief.md 和 content.json，然后 bcr-work preview ${id}`);
      if (!result.dependenciesInstalled) {
        emit(`尚未安装依赖：在工程目录运行 bun install --ignore-scripts`);
      }
      return;
    }
    case 'check': {
      if (id === 'all') {
        for (const entry of workspace().projects) {
          await check(project(entry.id));
        }
        return;
      }
      break;
    }
  }
  if (!id) {
    throw new Error('请指定工程 ID');
  }
  const current = project(id);
  switch (action) {
    case 'draft':
      return print(await locked(`audio:${id}`, async () => writeDraft(current, !!values.force)));
    case 'check':
      return check(current);
    case 'audio':
      return print(await audio(current, !!values.check, !!values.force));
    case 'releases':
      return print(releases(current));
    case 'release': {
      if (!values['from-dir']) {
        throw new Error('请指定 --from-dir 交付文件目录');
      }
      return print(await release(current, values['from-dir'], !!values.legacy));
    }
  }
  const target = targetOf(current, values.target);
  switch (action) {
    case 'build': {
      const result = await build(current, target);
      return values.json ? print(result) : emit(result.dir);
    }
    case 'preview':
      return preview(current, target, number('port') ?? 0);
    case 'capture':
      return printArtifact(await capture(current, target, number('frame') ?? 0, values.output));
    case 'render':
      return printArtifact(
        await render(current, target, {
          from: number('from'),
          to: number('to'),
          output: values.output,
          cq: number('cq'),
          concurrency: number('concurrency'),
          encoder: values.encoder,
          cpuReason: values['cpu-reason'],
        }),
      );
    default:
      throw new Error(`未知命令: ${action}`);
  }
}

try {
  await main();
  await collectCache();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
