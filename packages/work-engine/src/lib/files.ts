import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
export const sha = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const hashFile = (file: string) => sha(readFileSync(file));
export const json = <T = unknown>(file: string): T => JSON.parse(readFileSync(file, 'utf8'));
export function stable(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stable).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
export function atomicJSON(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temp, path);
}
export function inside(root: string, name: string): string {
  const path = resolve(root, name);
  if (path !== resolve(root) && !path.startsWith(resolve(root) + sep)) {
    throw new Error(`路径越界: ${name}`);
  }
  // Check existing ancestors as well as files: symbolic links must not escape a project.
  let existing = path;
  while (!existsSync(existing) && existing !== dirname(existing)) {
    existing = dirname(existing);
  }
  const realRoot = realpathSync(root);
  const real = realpathSync(existing);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new Error(`符号链接越界: ${name}`);
  }
  return path;
}
export function walk(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const result: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const file = join(root, name);
    const st = lstatSync(file);
    if (st.isSymbolicLink()) {
      throw new Error(`缓存/素材中不接受符号链接: ${file}`);
    }
    if (st.isDirectory()) {
      result.push(...walk(file));
    } else if (st.isFile()) {
      result.push(file);
    }
  }
  return result;
}
export function fileMap(root: string, files: string[]): Record<string, string> {
  return Object.fromEntries(
    [...new Set(files)].sort().map((f) => [relative(root, f), hashFile(f)]),
  );
}
export function verifyMap(root: string, files: Record<string, string>): boolean {
  try {
    return Object.entries(files).every(([f, hash]) => hashFile(inside(root, f)) === hash);
  } catch {
    return false;
  }
}
export function sourceGraph(root: string, entry: string): string[] {
  const seen = new Set<string>();
  function visit(file: string) {
    file = inside(root, file);
    if (seen.has(file)) {
      return;
    }
    if (!existsSync(file)) {
      throw new Error(`源码不存在: ${file}`);
    }
    seen.add(file);
    if (!/\.[cm]?[jt]sx?$/.test(file)) {
      return;
    }
    const text = readFileSync(file, 'utf8');
    const imports = ts.preProcessFile(text, true, true).importedFiles;
    for (const item of imports) {
      const spec = item.fileName;
      if (!spec.startsWith('.')) {
        continue;
      }
      const base = resolve(dirname(file), spec);
      const choices = [
        base,
        ...['.ts', '.tsx', '.js', '.jsx', '.json'].map((ext) => base + ext),
        ...['index.ts', 'index.tsx', 'index.js'].map((n) => join(base, n)),
      ];
      if (/\.jsx?$/.test(base)) {
        choices.push(base.replace(/\.jsx?$/, '.ts'), base.replace(/\.jsx?$/, '.tsx'));
      }
      const found = choices.find((f) => existsSync(f) && statSync(f).isFile());
      if (!found) {
        throw new Error(`无法解析本地依赖: ${spec} in ${file}`);
      }
      visit(found);
    }
  }
  visit(entry);
  return [...seen].sort();
}
