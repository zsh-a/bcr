import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { assets, hashFile, inside, locked, type Project, type Target, TOOLS } from '../core';
import { dependencies } from '../lib/dependencies';
import { props } from './props';

export async function compilePreview(p: Project, t: Target, signal?: AbortSignal) {
  return locked(`build:preview:${p.id}:${t.id}`, async () => {
    const environment = await dependencies(p, signal);
    const requireEngine = createRequire(join(TOOLS, 'package.json'));
    const requireProject = createRequire(join(environment, 'package.json'));
    const entry = join(TOOLS, `.preview-${randomUUID()}.tsx`);
    const settings = {
      width: t.width,
      height: t.height,
      fps: t.fps,
      durationInFrames: t.durationInFrames,
      inputProps: props(p, t),
      parameters: t.parameters ?? [],
    };
    writeFileSync(
      entry,
      `import ${t.exportName ? `{${t.exportName} as Scene}` : 'Scene'} from ${JSON.stringify(inside(p.root, t.entry))};
import { mountPreview } from './src/video/player';
mountPreview(Scene, ${JSON.stringify(settings)});
`,
    );
    try {
      const result = await Bun.build({
        entrypoints: [entry],
        target: 'browser',
        format: 'esm',
        minify: true,
        naming: 'player.[ext]',
        define: { 'process.env.NODE_ENV': '"production"' },
        plugins: [
          {
            name: 'locked-work-dependencies',
            setup(builder) {
              builder.onResolve({ filter: /^[^./]/ }, (args) => {
                const shared =
                  /^(react(?:\/.*)?|react-dom(?:\/.*)?|remotion(?:\/.*)?|@remotion\/player)$/.test(
                    args.path,
                  );
                if (shared) {
                  return { path: requireEngine.resolve(args.path) };
                }
                try {
                  return {
                    path: createRequire(args.importer || join(environment, 'package.json')).resolve(
                      args.path,
                    ),
                  };
                } catch {
                  return { path: requireProject.resolve(args.path) };
                }
              });
            },
          },
        ],
      });
      signal?.throwIfAborted();
      if (!result.success) {
        throw new Error(result.logs.join('\n'));
      }
      return result.outputs;
    } finally {
      rmSync(entry, { force: true });
    }
  });
}

export function previewDocument(outputs: readonly { path: string }[]) {
  const styles = outputs
    .filter((file) => file.path.endsWith('.css'))
    .map((file) => `<link rel="stylesheet" href="./${encodeURIComponent(basename(file.path))}">`)
    .join('');
  return `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;background:#111}</style>${styles}<div id="root"></div><script>window.remotion_staticBase=new URL('./public',location.href).pathname;</script><script type="module" src="./player.js"></script></html>`;
}

/** A preview keeps small JS artifacts; large assets remain in its immutable source snapshot. */
export async function writePreview(p: Project, t: Target, site: string, signal?: AbortSignal) {
  mkdirSync(site, { recursive: true });
  const outputs = await compilePreview(p, t, signal);
  for (const output of outputs) {
    await Bun.write(join(site, basename(output.path)), output);
  }
  writeFileSync(join(site, 'index.html'), previewDocument(outputs));
  return Object.fromEntries(
    assets(p, t).map((file) => [file.slice(p.root.length + 1), hashFile(file)]),
  );
}

export async function preview(p: Project, t: Target, port = 0) {
  return locked(`preview-source:${p.id}`, async () => {
    const permitted = new Set(assets(p, t).map((file) => resolve(file)));
    const scripts = t.runtime === 'remotion' ? await compilePreview(p, t) : [];
    const outputs = new Map(scripts.map((output) => [basename(output.path), output]));
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch(req) {
        try {
          const path = decodeURIComponent(new URL(req.url).pathname).slice(1);
          if (t.runtime === 'remotion' && (!path || path === 'index.html')) {
            return new Response(previewDocument(scripts), {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
          }
          const script = outputs.get(path);
          if (script) {
            return new Response(script);
          }
          const file = inside(p.root, path || t.entry);
          const pageFile =
            t.runtime === 'html' &&
            !path.startsWith('.') &&
            !path.startsWith('public/') &&
            !/^(package.json|bun.lock|voice.json|production.json)$/.test(path);
          if (!permitted.has(file) && !pageFile) {
            return new Response('Not found', { status: 404 });
          }
          return existsSync(file)
            ? new Response(Bun.file(file))
            : new Response('Not found', { status: 404 });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      },
    });
    console.log(`preview ${server.url} project=${p.id} target=${t.id}`);
    await new Promise<void>((resolveStop) => {
      const stop = () => {
        server.stop(true);
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        resolveStop();
      };
      process.on('SIGINT', stop);
      process.on('SIGTERM', stop);
    });
  });
}
