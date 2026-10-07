import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  atomicJSON,
  database,
  fileMap,
  hashFile,
  json,
  locked,
  MIGRATIONS,
  type Project,
  ROOT,
  STATE,
  sha,
  stable,
  targetIdentity,
  targetOf,
  verifyMap,
  walk,
} from './core';
import type { Baseline } from './maintenance/history';
import { probe } from './render';
import type { ArtifactReport } from './video/reports';

export const RELEASES = resolve(process.env.BCR_WORK_RELEASES ?? join(ROOT, '.releases'));
export async function release(p: Project, source: string, legacy = false, releaseRoot = RELEASES) {
  if (!legacy && p.config.stage === 'draft') {
    throw new Error('草稿不能正式交付，请先完成音频制作与全片导出');
  }
  return locked(`release:${p.id}`, async () => {
    const dir = resolve(source);
    if (!existsSync(dir) || !lstatSync(dir).isDirectory()) {
      throw new Error('交付源必须是目录');
    }
    const files = walk(dir).filter((f) => !basename(f).startsWith('.'));
    if (!files.length) {
      throw new Error('交付源为空');
    }
    // A release directory is an explicit selection, never a recursive project/public export.
    if (dir === p.root || dir === join(p.root, 'public') || dir === join(p.root, '.bcr')) {
      throw new Error('请将待交付文件放入独立目录，不能交付整个工程/缓存/私有素材目录');
    }
    const forbidden = p.config.privateAssets
      .map((x) => join(p.root, 'public', x))
      .filter(existsSync)
      .map(hashFile);
    const hashes = fileMap(dir, files);
    if (Object.values(hashes).some((h) => forbidden.includes(h))) {
      throw new Error('交付目录含参考录音或私有旁白，请排除后重试');
    }
    const media: {
      path: string;
      codec?: string | undefined;
      frames?: string | undefined;
      originalReport: ArtifactReport | null;
    }[] = [];
    for (const file of files.filter((f) => /\.mp4$/i.test(f))) {
      const result = await probe(file);
      const stream = result.streams.find((s) => s.codec_type === 'video');
      const reportFile = `${file}.json`;
      const report = existsSync(reportFile) ? json<ArtifactReport>(reportFile) : null;
      if (!legacy) {
        if (
          stream?.codec_name !== 'av1' ||
          report?.status !== 'succeeded' ||
          report.scope !== 'full' ||
          report.sha256 !== hashes[relative(dir, file)]
        ) {
          throw new Error(`新交付需要通过检查的全片 AV1 与对应 .json 报告: ${file}`);
        }
        if (
          report.project !== p.id ||
          targetIdentity(p, targetOf(p, report.target)).key !== report.input?.key
        ) {
          throw new Error(`成片与当前源码身份不一致: ${file}`);
        }
      }
      media.push({
        path: relative(dir, file),
        codec: stream?.codec_name,
        frames: stream?.nb_read_frames,
        originalReport: report,
      });
    }
    if (!legacy && !media.length) {
      throw new Error('新视频交付需要至少一部通过检查的完整 AV1 成片');
    }
    const id = sha(stable({ files: hashes, legacy, project: p.id })).slice(0, 20);
    const base = join(releaseRoot, p.id);
    const final = join(base, id);
    const stage = join(base, `.stage-${randomUUID()}`);
    mkdirSync(base, { recursive: true });
    if (!existsSync(final)) {
      mkdirSync(stage);
      try {
        for (const file of files) {
          const dest = join(stage, 'files', relative(dir, file));
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(file, dest);
        }
        if (!verifyMap(join(stage, 'files'), hashes) || !verifyMap(dir, hashes)) {
          throw new Error('交付复制期间文件变化');
        }
        atomicJSON(join(stage, 'manifest.json'), {
          version: 1,
          id,
          project: p.id,
          provenance: legacy ? 'legacy-import' : 'managed-production',
          sourceDirectory: dir,
          files: hashes,
          media,
          createdAt: new Date().toISOString(),
          reviews: {
            automatic: legacy ? 'historical-reports-preserved' : 'passed',
            listening: 'pending',
            viewing: 'pending',
            platformTranscode: 'pending',
          },
        });
        renameSync(stage, final);
      } catch (error) {
        rmSync(stage, { recursive: true, force: true });
        throw error;
      }
    } else if (!verifyMap(join(final, 'files'), hashes)) {
      throw new Error(`已有交付版本损坏: ${final}`);
    }
    const current = join(base, 'current');
    if (existsSync(current) && !lstatSync(current).isSymbolicLink()) {
      throw new Error('current 应为交付版本符号链接');
    }
    const link = join(base, `.current-${randomUUID()}`);
    symlinkSync(id, link, 'dir');
    renameSync(link, current);
    const db = database();
    db.query('INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?)').run(
      p.id,
      id,
      final,
      JSON.stringify(json(join(final, 'manifest.json'))),
      Date.now(),
    );
    db.close();
    return {
      project: p.id,
      id,
      path: final,
      current,
      files: files.length,
      provenance: legacy ? 'legacy-import' : 'managed-production',
    };
  });
}
export function releases(p: Project) {
  const db = database();
  const rows = db
    .query('SELECT id,path,created FROM releases WHERE project=? ORDER BY created DESC')
    .all(p.id);
  db.close();
  return rows;
}
export function registerHistory(p: Project) {
  const dir = join(p.root, 'out');
  if (!existsSync(dir)) {
    return { project: p.id, registered: false };
  }
  const baseline = json<Baseline>(join(MIGRATIONS, 'baseline-20261007.json'));
  const prefix = `${p.id}/out/`;
  const files = Object.fromEntries(
    Object.entries(baseline.files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, info]) => [path.slice(prefix.length), info.sha256]),
  );
  if (!verifyMap(dir, files)) {
    throw new Error(`历史交付与迁移基线不同，请先检查: ${p.id}`);
  }
  const id = `legacy-${sha(stable(files)).slice(0, 20)}`;
  const manifest = {
    version: 1,
    id,
    project: p.id,
    provenance: 'legacy-directory',
    path: dir,
    files,
    reviews: {
      automatic: 'original-reports-preserved',
      listening: 'pending',
      viewing: 'pending',
      platformTranscode: 'pending',
    },
    note: '登记既有文件，不复制、不转码；历史源码包仍是私有归档。',
    registeredAt: new Date().toISOString(),
  };
  atomicJSON(join(STATE, 'history', `${p.id}.json`), manifest);
  const db = database();
  db.query('INSERT OR IGNORE INTO releases VALUES (?,?,?,?,?)').run(
    p.id,
    id,
    dir,
    JSON.stringify(manifest),
    Date.now(),
  );
  db.close();
  return { project: p.id, id, path: dir, files: Object.keys(files).length, registered: true };
}
