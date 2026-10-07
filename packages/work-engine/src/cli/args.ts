import { parseArgs } from 'node:util';
export function parseCli(args = process.argv.slice(2)) {
  return parseArgs({
    args: args,
    allowPositionals: true,
    strict: true,
    options: {
      root: { type: 'string' },
      title: { type: 'string' },
      'no-install': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      target: { type: 'string' },
      output: { type: 'string' },
      frame: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      cq: { type: 'string' },
      concurrency: { type: 'string' },
      encoder: { type: 'string' },
      'cpu-reason': { type: 'string' },
      port: { type: 'string' },
      check: { type: 'boolean' },
      'require-raw': { type: 'boolean' },
      force: { type: 'boolean' },
      apply: { type: 'boolean' },
      'budget-gib': { type: 'string' },
      'legacy-scratch': { type: 'boolean' },
      'dedup-snapshots': { type: 'boolean' },
      'from-dir': { type: 'string' },
      legacy: { type: 'boolean' },
      json: { type: 'boolean' },
    },
  });
}
