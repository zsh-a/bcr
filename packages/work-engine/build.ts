import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const engine = import.meta.dir;
const out = resolve(values.out ?? join(engine, '../../dist/work-engine'));
const stage = mkdtempSync(join(tmpdir(), 'bcr-work-release-'));
const source = JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')) as {
  version: string;
  dependencies: Record<string, string>;
};
const requireEngine = createRequire(join(engine, 'package.json'));
const dependencies = Object.fromEntries(
  Object.keys(source.dependencies).map((name) => [
    name,
    (
      JSON.parse(readFileSync(requireEngine.resolve(`${name}/package.json`), 'utf8')) as {
        version: string;
      }
    ).version,
  ]),
);
try {
  mkdirSync(join(stage, 'dist'), { recursive: true });
  writeFileSync(
    join(stage, 'dist/work.js'),
    "#!/usr/bin/env bun\nimport '../engine/src/cli.ts';\n",
  );
  chmodSync(join(stage, 'dist/work.js'), 0o755);
  writeFileSync(
    join(stage, 'package.json'),
    JSON.stringify(
      {
        name: '@bcr/work-cli',
        version: source.version,
        type: 'module',
        bin: { 'bcr-work': './dist/work.js' },
        files: ['dist', 'engine', 'release.json'],
        dependencies,
      },
      null,
      2,
    ),
  );
  for (const path of ['src', 'templates', 'package.json', 'tsconfig.json', 'biome-project.json']) {
    cpSync(join(engine, path), join(stage, 'engine', path), { recursive: true });
  }
  for (const path of ['scripts', 'tests', 'pyproject.toml', 'uv.lock']) {
    cpSync(join(engine, 'audio', path), join(stage, 'engine/audio', path), {
      recursive: true,
      filter: (path) => !path.endsWith('.pyc') && !path.includes('__pycache__'),
    });
  }
  const lock = Bun.spawnSync([process.execPath, 'install', '--lockfile-only', '--ignore-scripts'], {
    cwd: stage,
  });
  if (lock.exitCode) {
    throw new Error(lock.stderr.toString());
  }
  const files: Record<string, string> = {};
  function collect(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        collect(join(directory, entry.name), path);
      } else if (entry.isFile()) {
        files[path] = createHash('sha256')
          .update(readFileSync(join(directory, entry.name)))
          .digest('hex');
      } else {
        throw new Error(`Unexpected release payload: ${path}`);
      }
    }
  }
  collect(stage);
  const build = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  writeFileSync(
    join(stage, 'release.json'),
    JSON.stringify({ version: source.version, build, dependencies, files }, null, 2),
  );
  const directory = join(out, 'package');
  mkdirSync(out, { recursive: true });
  rmSync(directory, { recursive: true, force: true });
  cpSync(stage, directory, { recursive: true });
  console.log(JSON.stringify({ directory, version: source.version, build }));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
