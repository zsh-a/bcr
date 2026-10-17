import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { json } from './lib/files';
import { TOOLS } from './lib/paths';

export function version() {
  const release = join(TOOLS, '../release.json');
  if (existsSync(release)) {
    const { version, build } = json<{ version: string; build: string }>(release);
    return { version, build };
  }
  return { version: json<{ version: string }>(join(TOOLS, 'package.json')).version, source: true };
}
