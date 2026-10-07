import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashFile, json, MIGRATIONS, ROOT } from '../core';
export interface Baseline {
  files: Record<string, { sha256: string }>;
}

export function verifyBaseline() {
  const baseline = json<Baseline>(join(MIGRATIONS, 'baseline-20261007.json'));
  const changed = Object.entries(baseline.files)
    .filter(
      ([path, info]) => !existsSync(join(ROOT, path)) || hashFile(join(ROOT, path)) !== info.sha256,
    )
    .map(([path]) => path);
  return { checked: Object.keys(baseline.files).length, unchanged: changed.length === 0, changed };
}
