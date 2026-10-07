import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const testState = mkdtempSync(join(tmpdir(), 'bcr-manager-state-test-'));
process.env.BCR_WORK_STATE = join(testState, 'state');
process.env.BCR_WORK_CACHE = join(testState, 'cache');
process.env.BCR_WORK_RELEASES = join(testState, 'releases');
