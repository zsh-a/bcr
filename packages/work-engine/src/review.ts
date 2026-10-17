import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { hashFile, inside, json, sha, stable } from './lib/files';
import { type Project, type Target, targetIdentity } from './project';

export const reviewKinds = ['script', 'pilot', 'visual', 'listening'] as const;
type ReviewKind = (typeof reviewKinds)[number];
interface ReviewOptions {
  kind?: string;
  status?: string;
  note?: string;
  evidence?: string;
  reviewer?: string;
  reviewerType?: string;
  scope?: string;
}
interface ReviewRecord {
  version: 1;
  id: string;
  project: string;
  target: string;
  kind: ReviewKind;
  status: 'passed' | 'needs-work';
  scope: 'sample' | 'full';
  note: string;
  createdAt: string;
  reviewer: {
    name: string;
    type: 'human' | 'agent';
    source: 'caller-declared';
    independentlyVerified: false;
  };
  input: { key: string };
  reviewInput: { key: string; policy: string; files?: Record<string, string | null> };
  evidence: { path: string; sha256: string; bytes: number };
}

function evidenceHash(path: string) {
  const hash = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  try {
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (!count) {
        break;
      }
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest('hex');
  } finally {
    closeSync(descriptor);
  }
}

function reviewInput(p: Project, t: Target, kind: ReviewKind) {
  const paths =
    kind === 'script'
      ? [
          p.config.audio?.content ?? 'content.json',
          'docs/brief.md',
          'brief.md',
          'sources.json',
          'model-inputs.json',
          'data.json',
          'src/model.ts',
          'model.js',
          'scripts/model.py',
          'src/model.js',
          'docs/argument-review.md',
        ]
      : kind === 'listening'
        ? [
            p.config.audio?.content ?? 'content.json',
            p.config.audio?.voice,
            p.config.audio?.timeline,
            p.config.audio?.plan,
            p.config.audio?.mastering,
            p.config.audio?.quality,
            p.config.targets[t.id]?.audio ? `public/${p.config.targets[t.id]!.audio}` : undefined,
          ]
        : [p.config.audio?.content ?? 'content.json'];
  const files = Object.fromEntries(
    [...new Set(paths.filter((path): path is string => !!path))].sort().map((path) => {
      const absolute = inside(p.root, path);
      return [path, existsSync(absolute) ? hashFile(absolute) : null];
    }),
  );
  const policy =
    kind === 'script'
      ? 'authored-script-inputs-v1'
      : kind === 'listening'
        ? 'audio-inputs-and-evidence-v1'
        : 'target-input-and-evidence-v1';
  const input =
    kind === 'script'
      ? { project: p.id, title: p.work.title, target: t.id, files }
      : kind === 'listening'
        ? { target: t.id, files }
        : {
            key: targetIdentity(p, t).key,
            content: files[p.config.audio?.content ?? 'content.json'] ?? null,
          };
  return {
    key: sha(stable(input)),
    policy,
    ...(kind === 'script' || kind === 'listening' ? { files } : {}),
  };
}

/** Records a caller's report of an existing check; never performs or verifies human review. */
export function recordReview(p: Project, t: Target, options: ReviewOptions) {
  if (!reviewKinds.includes(options.kind as ReviewKind)) {
    throw new Error('--kind 需要 script|pilot|visual|listening');
  }
  if (!['passed', 'needs-work'].includes(options.status ?? '')) {
    throw new Error('--status 需要 passed|needs-work');
  }
  for (const [name, value, limit] of [
    ['note', options.note, 2000],
    ['reviewer', options.reviewer, 160],
  ] as const) {
    if (!value?.trim() || value.length > limit) {
      throw new Error(`--${name} 必填且长度不超过 ${limit} 字符`);
    }
  }
  const reviewerType = options.reviewerType ?? 'agent';
  if (!['human', 'agent'].includes(reviewerType)) {
    throw new Error('--reviewer-type 需要 human|agent');
  }
  if (options.kind === 'listening' && reviewerType !== 'human') {
    throw new Error(
      'listening 登记仅用于已经发生的人工听审；需显式 --reviewer-type human，并如实填写检查人。机器分析不能登记为人工听审。',
    );
  }
  const scope = options.scope ?? (options.kind === 'script' ? 'full' : 'sample');
  if (!['sample', 'full'].includes(scope) || (options.kind === 'pilot' && scope !== 'sample')) {
    throw new Error('--scope 需要 sample|full；pilot 仅能登记 sample，不能代表全片');
  }
  if (!options.evidence || options.evidence.length > 1000 || isAbsolute(options.evidence)) {
    throw new Error('--evidence 需要真实存在的项目内相对文件路径');
  }
  const evidence = inside(p.root, options.evidence);
  if (!existsSync(evidence) || !statSync(evidence).isFile()) {
    throw new Error('验收证据文件不存在或不是普通文件');
  }
  const kind = options.kind as ReviewKind;
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.hrtime.bigint().toString(16).padStart(16, '0')}-${randomUUID()}`;
  const record: ReviewRecord = {
    version: 1,
    id,
    project: p.id,
    target: t.id,
    kind,
    status: options.status as ReviewRecord['status'],
    scope: scope as ReviewRecord['scope'],
    note: options.note!,
    createdAt: new Date().toISOString(),
    reviewer: {
      name: options.reviewer!,
      type: reviewerType as 'human' | 'agent',
      source: 'caller-declared',
      independentlyVerified: false,
    },
    input: { key: targetIdentity(p, t).key },
    reviewInput: reviewInput(p, t, kind),
    evidence: {
      path: relative(p.root, evidence),
      sha256: evidenceHash(evidence),
      bytes: statSync(evidence).size,
    },
  };
  const directory = inside(p.root, '.bcr/reviews');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return {
    ...record,
    path: `.bcr/reviews/${id}.json`,
    policy:
      'Caller-declared record; human identity and performance were not independently verified. This does not run QA, approve publication, or turn sample review into full review.',
  };
}

function validRecord(value: unknown): value is ReviewRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as ReviewRecord;
  const short = (value: unknown, limit: number) =>
    typeof value === 'string' && value.length <= limit;
  const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  return (
    record.version === 1 &&
    reviewKinds.includes(record.kind) &&
    ['passed', 'needs-work'].includes(record.status) &&
    ['sample', 'full'].includes(record.scope) &&
    short(record.id, 100) &&
    short(record.project, 100) &&
    short(record.target, 160) &&
    short(record.createdAt, 40) &&
    short(record.note, 2000) &&
    short(record.reviewer?.name, 160) &&
    ['human', 'agent'].includes(record.reviewer?.type) &&
    record.reviewer.source === 'caller-declared' &&
    record.reviewer.independentlyVerified === false &&
    (record.kind !== 'listening' || record.reviewer.type === 'human') &&
    digest(record.input?.key) &&
    digest(record.reviewInput?.key) &&
    short(record.evidence?.path, 1000) &&
    digest(record.evidence?.sha256) &&
    Number.isFinite(record.evidence?.bytes) &&
    record.evidence.bytes >= 0
  );
}

export function reviewStatus(p: Project, t: Target) {
  const directory = inside(p.root, '.bcr/reviews');
  const latest = new Map<ReviewKind, ReviewRecord>();
  let ignoredRecords = 0;
  if (existsSync(directory)) {
    for (const name of readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse()) {
      try {
        const path = inside(p.root, `.bcr/reviews/${name}`);
        if (!statSync(path).isFile() || statSync(path).size > 32_000) {
          ignoredRecords++;
          continue;
        }
        const record = json(path);
        if (!validRecord(record) || `${record.id}.json` !== name) {
          ignoredRecords++;
          continue;
        }
        if (record.project !== p.id || record.target !== t.id) {
          continue;
        }
        if (!latest.has(record.kind)) {
          latest.set(record.kind, record);
        }
      } catch {
        ignoredRecords++;
      }
    }
  }
  const items = reviewKinds.map((kind) => {
    const record = latest.get(kind);
    if (!record) {
      return { kind, status: 'missing' as const };
    }
    let fresh = false;
    let reason: string | undefined;
    try {
      fresh =
        record.reviewInput.key === reviewInput(p, t, kind).key &&
        evidenceHash(inside(p.root, record.evidence.path)) === record.evidence.sha256;
      if (!fresh) {
        reason = '创作输入、所审产物或证据已变化';
      }
    } catch {
      reason = '无法核对当前输入或证据文件';
    }
    return {
      kind,
      status: !fresh
        ? ('stale' as const)
        : record.status === 'passed'
          ? ('fresh' as const)
          : ('needs-work' as const),
      id: record.id,
      scope: record.scope,
      createdAt: record.createdAt,
      reviewer: record.reviewer,
      note: {
        value: record.note.slice(0, 240),
        truncated: record.note.length > 240,
        omittedCharacters: Math.max(0, record.note.length - 240),
      },
      evidence: record.evidence,
      reason,
    };
  });
  return {
    items,
    ignoredRecords,
    policy:
      'Reported checks only; caller identity/performance unverified. Fresh sample/pilot does not establish full review. Technical QA and publication authorization remain separate.',
  };
}
