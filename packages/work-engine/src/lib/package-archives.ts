import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile, inside } from './files';

export type PackageArchive = { name: string; relative: string; path: string; sha256: string };

/** Vendored archives are snapshot input; local folders and links remain unsupported. */
export function packageArchives(root: string, declared: Record<string, string>): PackageArchive[] {
  const result: PackageArchive[] = [];
  for (const [name, version] of Object.entries(declared)) {
    if (!version.startsWith('file:')) {
      if (/^(?:workspace:|link:|\.\.?\/|\/)/u.test(version)) {
        throw new Error('快照依赖不支持工程外的本地路径');
      }
      continue;
    }
    const relative = version.slice(5);
    const parts = relative.split('/');
    if (
      !relative.startsWith('vendor/') ||
      !relative.endsWith('.tgz') ||
      parts.some((part) => !part || part === '.' || part === '..')
    ) {
      throw new Error('本地快照依赖必须是 vendor/ 内的 .tgz 包归档');
    }
    const path = inside(root, relative);
    for (let i = 1; i <= parts.length; i++) {
      if (lstatSync(join(root, ...parts.slice(0, i))).isSymbolicLink()) {
        throw new Error('包归档路径不能包含符号链接');
      }
    }
    if (!lstatSync(path).isFile()) {
      throw new Error('包归档必须是普通文件');
    }
    result.push({ name, relative, path, sha256: hashFile(path) });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}
