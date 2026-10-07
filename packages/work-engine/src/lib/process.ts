import { ROOT } from './paths';
export async function command(
  cmd: string[],
  cwd = ROOT,
  env: Record<string, string | undefined> = {},
  capture = false,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const p = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: capture ? 'pipe' : 'inherit',
    stderr: capture ? 'pipe' : 'inherit',
  });
  const abort = () => p.kill();
  signal?.addEventListener('abort', abort, { once: true });
  const output = capture ? new Response(p.stdout).text() : Promise.resolve('');
  const error = capture ? new Response(p.stderr).text() : Promise.resolve('');
  const code = await p.exited;
  const out = await output;
  const err = await error;
  signal?.removeEventListener('abort', abort);
  signal?.throwIfAborted();
  if (code !== 0) {
    throw new Error(`${cmd[0]} 退出 ${code}: ${err.slice(-4000)}`);
  }
  return out;
}
