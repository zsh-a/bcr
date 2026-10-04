import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createRequire } from "node:module";
import { bundle } from "@remotion/bundler";
import { makeCancelSignal, renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import type { Project, RenderRequest, Target } from "@bcr/work-core";
import { hash, json } from "./projects";
import { dependencyDirectory, release } from "./installation";
import { prepareBrowser } from "./browser";

export const REMOTION_VERSION = "4.0.532";
type Context = {
  directory: string;
  source: string;
  project: Project;
  request: RenderRequest;
  signal: AbortSignal;
  report: (progress: number, stage: string) => void;
};

async function dependencies(root: string, signal: AbortSignal) {
  if (!existsSync(join(root, "package.json"))) {
    // A dependency-free project uses the runner's pinned engine, never a mutable project node_modules.
    for (const name of Object.keys(release().dependencies)) {
      const destination = join(root, "node_modules", name);
      mkdirSync(dirname(destination), { recursive: true });
      symlinkSync(dependencyDirectory(name), destination, "dir");
    }
    return;
  }
  if (!existsSync(join(root, "bun.lock")))
    throw new Error("自定义依赖需要提交 bun.lock；先在工程目录运行 bun install");
  const manifest = json(join(root, "package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: unknown;
    trustedDependencies?: unknown;
  };
  if (manifest.workspaces) throw new Error("渲染工程需要独立的 package.json 与 bun.lock");
  for (const version of Object.values({ ...manifest.dependencies, ...manifest.devDependencies })) {
    if (/^(?:workspace:|file:|link:|\.\.?\/|\/)/u.test(version))
      throw new Error("快照依赖不支持工程外的本地路径");
  }
  const child = Bun.spawn([process.execPath, "install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CI: "1" },
  });
  const abort = () => child.kill();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const [code, output] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
    signal.throwIfAborted();
    if (code !== 0) throw new Error(`依赖安装失败：${output.slice(-4000)}`);
  } finally {
    signal.removeEventListener("abort", abort);
  }
  const requireProject = createRequire(join(root, "package.json"));
  for (const name of ["remotion", "@remotion/player"]) {
    if (requireProject(`${name}/package.json`).version !== REMOTION_VERSION)
      throw new Error(`${name} 必须固定为 ${REMOTION_VERSION}`);
  }
}

function props(root: string, target: Target): Record<string, unknown> {
  if (target.runtime !== "remotion" || !target.propsFile) return {};
  const value = json(join(root, target.propsFile));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("propsFile 必须是 JSON 对象");
  return value as Record<string, unknown>;
}

const control = `
function connect(player) {
  let port;
  const send = (v) => port?.postMessage(v);
  const status = () => ({ frame: player?.current?.getCurrentFrame() ?? null, text: document.body.innerText.slice(0, 8000) });
  addEventListener('error', e => send({type:'report',message:String(e.message).slice(0,2000)}));
  addEventListener('unhandledrejection', e => send({type:'report',message:String(e.reason).slice(0,2000)}));
  addEventListener('message', e => {
    if(e.source !== parent || e.data !== 'bcr-work-connect' || !e.ports[0] || port) return;
    port = e.ports[0];
    port.onmessage = ({data:d}) => {
      try {
        if(d.action === 'seek') player?.current?.seekTo(d.frame);
        if(d.action === 'play') player?.current?.play();
        if(d.action === 'pause') player?.current?.pause();
        send({type:'result',id:d.id,result:status()});
      } catch(e) { send({type:'result',id:d.id,error:String(e)}); }
    };
    const ready = () => {
      if(player && !player.current) { requestAnimationFrame(ready); return; }
      const current = player?.current;
      let lastUpdate = 0;
      const publishFrame = () => {
        lastUpdate = performance.now();
        send({type:'frame',frame:current.getCurrentFrame()});
      };
      const onFrame = () => {
        if(!current.isPlaying() || performance.now() - lastUpdate >= 100) publishFrame();
      };
      if(current) {
        current.addEventListener('frameupdate', onFrame);
        current.addEventListener('pause', publishFrame);
        current.addEventListener('seeked', publishFrame);
        addEventListener('pagehide', () => {
          current.removeEventListener('frameupdate', onFrame);
          current.removeEventListener('pause', publishFrame);
          current.removeEventListener('seeked', publishFrame);
        }, {once:true});
      }
      send({type:'ready',...status()});
    };
    ready();
  });
}
`;

export async function execute(context: Context): Promise<void> {
  const { directory, source, project, request, signal, report } = context;
  const root = join(directory, "project"),
    outputs = join(directory, "outputs"),
    site = join(directory, "site");
  mkdirSync(root, { recursive: true });
  mkdirSync(outputs, { recursive: true });
  for (const file of project.files) {
    const bytes = readFileSync(join(source, file.path));
    if (hash(bytes) !== file.hash) throw new Error(`快照校验失败：${file.path}`);
    const path = join(root, file.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
  }
  const target = project.targets.find((t) => t.id === request.target);
  if (!target) throw new Error("目标不存在");
  if (request.kind === "archive") {
    // Bun.Archive includes only the verified sources and a manifest; no dependencies, credentials or build cache.
    const files: Record<string, Uint8Array> = Object.create(null);
    for (const file of project.files)
      files[file.path] = new Uint8Array(readFileSync(join(root, file.path)));
    files["bcr-snapshot.json"] = new TextEncoder().encode(
      JSON.stringify({ project, engine: REMOTION_VERSION }, null, 2),
    );
    await Bun.write(join(outputs, "source.tar.gz"), new Bun.Archive(files, { compress: "gzip" }));
    report(1, "归档完成");
    return;
  }
  if (target.runtime === "html") {
    if (!["preview", "validate"].includes(request.kind))
      throw new Error("HTML 目标仅支持预览、验证与源码归档");
    if (!/\.html?$/iu.test(target.entry)) throw new Error("HTML 目标入口必须是 HTML 文件");
    if (request.kind === "preview") {
      cpSync(root, site, { recursive: true });
      const file = join(site, target.entry);
      writeFileSync(join(site, "bcr-preview.js"), `${control}\nconnect(null);`);
      const script = `${"../".repeat(target.entry.split("/").length - 1)}bcr-preview.js`;
      writeFileSync(
        file,
        `${readFileSync(file, "utf8")}\n<script src=${JSON.stringify(script)}></script>`,
      );
    }
    report(1, "HTML 就绪");
    return;
  }
  report(0.05, "准备锁定依赖");
  await dependencies(root, signal);
  signal.throwIfAborted();
  const inputProps = props(root, target);
  const component = `import ${target.exportName ? `{${target.exportName} as Component}` : "Component"} from ${JSON.stringify(`./${target.entry}`)};`;
  if (request.kind === "preview") {
    mkdirSync(site, { recursive: true });
    if (existsSync(join(root, "public")))
      cpSync(join(root, "public"), join(site, "public"), { recursive: true });
    const entry = join(root, ".bcr-player.tsx");
    writeFileSync(
      entry,
      `import React from 'react'; import {createRoot} from 'react-dom/client'; import {Player} from '@remotion/player'; ${component}
      ${control}
      window.remotion_staticBase = './public'; const playerRef = React.createRef(); connect(playerRef);
      function Preview(){return <Player ref={playerRef} component={Component} inputProps={${JSON.stringify(inputProps)}} durationInFrames={${target.durationInFrames}} compositionWidth={${target.width}} compositionHeight={${target.height}} fps={${target.fps}} controls initialVolume={1} style={{width:'100%',height:'100%'}}/>}
      createRoot(document.getElementById('root')).render(<Preview/>);`,
    );
    report(0.2, "构建播放器");
    const build = await Bun.build({
      entrypoints: [entry],
      outdir: site,
      target: "browser",
      format: "esm",
      minify: true,
      naming: "player.[ext]",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    if (!build.success) throw new Error(build.logs.map(String).join("\n"));
    const styles = build.outputs
      .filter((file) => file.path.endsWith(".css"))
      .map((file) => `<link rel="stylesheet" href="./${encodeURIComponent(basename(file.path))}">`)
      .join("");
    writeFileSync(
      join(site, "index.html"),
      `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{margin:0;width:100%;height:100%;background:#111}</style>${styles}<div id="root"></div><script>window.remotion_staticBase=new URL('./public',location.href).pathname;</script><script type="module" src="./player.js"></script></html>`,
    );
    report(1, "播放器就绪");
    return;
  }
  const entry = join(root, ".bcr-render.tsx");
  const compositionId = `BCR-${hash(target.id).slice(0, 16)}`;
  writeFileSync(
    entry,
    `import React from 'react'; import {registerRoot,Composition} from 'remotion'; ${component}\nregisterRoot(()=> <Composition id=${JSON.stringify(compositionId)} component={Component} width={${target.width}} height={${target.height}} fps={${target.fps}} durationInFrames={${target.durationInFrames}} defaultProps={${JSON.stringify(inputProps)}}/>);`,
  );
  report(0.1, "构建渲染工程");
  const serveUrl = await bundle({
    entryPoint: entry,
    rootDir: root,
    outDir: join(directory, "bundle"),
    publicDir: existsSync(join(root, "public")) ? join(root, "public") : null,
    onProgress: (n) => report(0.1 + (n / 100) * 0.25, "构建渲染工程"),
  });
  signal.throwIfAborted();
  const browser = { browserExecutable: await prepareBrowser() };
  const composition = await selectComposition({
    serveUrl,
    id: compositionId,
    inputProps,
    ...browser,
  });
  const { cancel, cancelSignal } = makeCancelSignal();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.kind === "capture" || request.kind === "validate") {
      const frames = request.kind === "validate" ? [0] : (request.frames ?? [0]);
      for (const [i, frame] of frames.entries()) {
        signal.throwIfAborted();
        if (frame >= composition.durationInFrames) throw new Error("关键帧超出作品时长");
        await renderStill({
          composition,
          serveUrl,
          inputProps,
          frame,
          output: join(outputs, `frame-${frame}.png`),
          imageFormat: "png",
          scale: request.scale ?? 1,
          cancelSignal,
          ...browser,
        });
        report(0.4 + 0.6 * ((i + 1) / frames.length), `关键帧 ${frame}`);
      }
    } else if (request.kind === "video") {
      const from = request.from ?? 0,
        to = request.to ?? composition.durationInFrames - 1;
      if (to < from || to >= composition.durationInFrames) throw new Error("视频帧范围无效");
      await renderMedia({
        composition,
        serveUrl,
        inputProps,
        codec: "h264",
        outputLocation: join(outputs, "video.mp4"),
        frameRange: [from, to],
        scale: request.scale ?? 1,
        concurrency: 2,
        cancelSignal,
        ...browser,
        onProgress: ({ progress }) => report(0.4 + progress * 0.6, "编码视频"),
      });
    }
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
