import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  atomicJSON,
  fileMap,
  hashFile,
  inside,
  json,
  sha,
  sourceGraph,
  stable,
  verifyExactMap,
  walk,
} from '../lib/files';
import { TOOLS } from '../lib/paths';
import { command } from '../lib/process';
import { type Project, type Target, targetIdentity } from '../project';
import { locked } from '../state/lock';
import { startPreview } from '../video/preview';
import { checkScenes } from '../video/scenes/check';
import { prepareRuntime } from './runtime';

interface ValidationReport {
  status: string;
  key: string;
  input: { key: string };
  directory: string;
  files: Record<string, string>;
  checks: { id: string; status: string }[];
  createdAt: string;
}
const latestPath = (p: Project) => join(p.root, '.bcr/build/validation.json');
export function validationIdentity(p: Project, t: Target) {
  const checks = p.config.validation?.checks ?? [];
  const files = checks.flatMap((check) => {
    const script = check.command[1];
    if (!script || !existsSync(join(p.root, script))) {
      throw new Error(`验收命令需声明本期脚本: ${check.id}`);
    }
    return /\.[jt]sx?$/.test(script)
      ? sourceGraph(p.root, script, { externalEntries: [join(p.root, '../.tools'), TOOLS] })
      : [inside(p.root, script)];
  });
  return sha(
    stable({
      input: targetIdentity(p, t).key,
      checks,
      files: fileMap(p.root, files),
      validator: hashFile(import.meta.filename),
    }),
  );
}

export function validationStatus(p: Project, t: Target) {
  if (!p.config.validation || (p.config.validation.target ?? 'main') !== t.id) {
    return { configured: false, fresh: true };
  }
  try {
    const key = validationIdentity(p, t);
    const report = existsSync(latestPath(p)) ? json<ValidationReport>(latestPath(p)) : undefined;
    const fresh =
      report?.status === 'passed' &&
      report.key === key &&
      report.input.key === targetIdentity(p, t).key &&
      verifyExactMap(inside(p.root, report.directory), report.files);
    return {
      configured: true,
      fresh,
      key,
      report: fresh ? report : undefined,
      reason: fresh ? undefined : '验收缺失或已过期，请执行 qa',
    };
  } catch (error) {
    return {
      configured: true,
      fresh: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
export function assertValidation(p: Project, t: Target) {
  const status = validationStatus(p, t);
  if (!status.fresh) {
    throw new Error(status.reason);
  }
  return status;
}

export async function validate(p: Project, t: Target, force = false) {
  prepareRuntime(p);
  if (!p.config.validation) {
    throw new Error('未配置本期验收');
  }
  const configuration = p.config.validation;
  return locked(`qa:${p.id}`, async () => {
    const existing = validationStatus(p, t);
    if (!force && existing.fresh && existing.report) {
      return { ...existing.report, cached: true };
    }
    const key = validationIdentity(p, t);
    const input = targetIdentity(p, t);
    const directory = join(p.root, '.bcr/reports', input.key, randomUUID());
    mkdirSync(directory, { recursive: true });
    const preview = await startPreview(p, t);
    if (preview.input.key !== input.key) {
      preview.stop();
      throw new Error('验收预览身份不一致');
    }
    const checks = [];
    try {
      for (const check of configuration.checks) {
        await command(check.command, p.root, {
          BCR_QA_URL: preview.url,
          BCR_QA_OUTPUT: directory,
          BCR_QA_INPUT: JSON.stringify(input),
        });
        checks.push({ id: check.id, status: 'passed' });
      }
      if (p.config.scenes) {
        await checkScenes(p, t, { directory: join(directory, 'scenes') });
        checks.push({ id: 'scene-equivalence', status: 'passed' });
      }
      if (validationIdentity(p, t) !== key || targetIdentity(p, t).key !== input.key) {
        throw new Error('验收期间输入或检查程序变化');
      }
      const report: ValidationReport = {
        status: 'passed',
        key,
        input,
        directory: relative(p.root, directory),
        files: fileMap(directory, walk(directory)),
        checks,
        createdAt: new Date().toISOString(),
      };
      atomicJSON(latestPath(p), report);
      return report;
    } finally {
      preview.stop();
    }
  });
}

export function freeze(p: Project, t: Target) {
  const status = assertValidation(p, t);
  const input = targetIdentity(p, t);
  const record = {
    input,
    validationKey: status.key,
    report: relative(p.root, latestPath(p)),
    createdAt: new Date().toISOString(),
    continuousHumanReview: 'pending',
  };
  atomicJSON(join(p.root, '.bcr/build/frozen.json'), record);
  return record;
}
