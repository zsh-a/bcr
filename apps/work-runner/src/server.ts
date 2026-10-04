import { timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { decode, Id, Path } from "@bcr/work-core";
import { hash } from "./projects";
import { RunnerService } from "./service";

export type RunnerConfig = {
  root: string;
  state: string;
  token: string;
  origin: string;
  port?: number;
  host?: string;
  previewPort?: number;
  apiUrl?: string;
  previewUrl?: string;
  onShutdown?: () => void;
};
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function startRunner(config: RunnerConfig) {
  if (config.token.length < 32) throw new Error("Runner 配对密钥至少需要 32 个字符");
  const origin = new URL(config.origin).origin;
  if (origin !== config.origin || !/^https?:/u.test(origin))
    throw new Error("BCR origin 必须是完整的 HTTP(S) origin");
  const host = config.host ?? "127.0.0.1";
  const apiOrigin = config.apiUrl ? httpOrigin(config.apiUrl) : undefined;
  const previewOrigin = config.previewUrl ? httpOrigin(config.previewUrl) : undefined;
  if (!["127.0.0.1", "localhost", "::1"].includes(host) && (!apiOrigin || !previewOrigin))
    throw new Error("非 loopback 监听必须显式设置 --api-url 与 --preview-url");
  for (const port of [config.port ?? 5210, config.previewPort ?? 0])
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("端口无效");
  if (
    apiOrigin === origin ||
    previewOrigin === origin ||
    (apiOrigin && apiOrigin === previewOrigin)
  )
    throw new Error("控制 API、预览和 BCR 必须使用不同来源");
  const service = new RunnerService(config.root, config.state, origin);
  const { projects, jobs, engine } = service;
  const preview = Bun.serve({
    hostname: host,
    port: config.previewPort ?? 0,
    fetch(request) {
      const url = new URL(request.url);
      if (
        !validHost(request, preview.port, previewOrigin) ||
        !["GET", "HEAD"].includes(request.method)
      )
        return new Response("Forbidden", { status: 403 });
      try {
        const [id, ...segments] = url.pathname.slice(1).split("/");
        const job = jobs.get(decode(Id, id));
        if (job.status !== "succeeded" || job.request.kind !== "preview")
          throw new Error("预览未就绪");
        const path = decode(Path, decodeURIComponent(segments.join("/"))),
          root = join(jobs.directory(job.id), "site"),
          file = join(root, path);
        if (
          !existsSync(file) ||
          !lstatSync(file).isFile() ||
          relative(realpathSync(root), realpathSync(file)).startsWith(`..${sep}`)
        )
          return new Response("Not found", { status: 404 });
        return new Response(Bun.file(file), {
          headers: {
            "Content-Security-Policy": `default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'; frame-ancestors ${origin}; frame-src 'none'; worker-src 'none'`,
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Cross-Origin-Embedder-Policy": "credentialless",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Cache-Control": "no-store",
          },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  });
  const urlFor = (id: string) => {
    const job = jobs.get(id);
    if (job.request.kind !== "preview" || job.status !== "succeeded") throw new Error("预览未就绪");
    const project = projects.snapshot(job.request.id, job.request.revision),
      target = project.targets.find((t) => t.id === job.request.target)!;
    return {
      url: `${previewOrigin ?? `http://127.0.0.1:${preview.port}`}/${job.id}/${target.runtime === "html" ? target.entry.split("/").map(encodeURIComponent).join("/") : "index.html"}`,
      revision: project.revision,
      target,
    };
  };
  let api: Bun.Server<undefined>;
  try {
    api = Bun.serve({
      hostname: host,
      port: config.port ?? 5210,
      maxRequestBodySize: 1024 * 1024,
      async fetch(request) {
        const headers = {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Private-Network": "true",
          Vary: "Origin",
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "cross-origin",
        };
        const respond = (value: unknown, status = 200) => Response.json(value, { status, headers });
        if (
          !validHost(request, api.port, apiOrigin) ||
          (request.headers.has("origin") && request.headers.get("origin") !== origin)
        )
          return respond({ error: "Origin or Host rejected" }, 403);
        if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
        if (!equal(request.headers.get("authorization") ?? "", `Bearer ${config.token}`))
          return respond({ error: "配对密钥无效" }, 401);
        const url = new URL(request.url);
        try {
          if (request.method === "POST" && url.pathname === "/shutdown" && config.onShutdown) {
            setTimeout(config.onShutdown, 50);
            return respond({ stopping: true, instanceId: service.instanceId });
          }
          if (request.method === "GET" && url.pathname === "/health")
            return respond(service.catalog());
          if (request.method === "GET" && url.pathname.startsWith("/outputs/")) {
            const [, , id, name] = url.pathname.split("/");
            const job = jobs.get(decode(Id, id)),
              output = job.outputs.find((o) => o.name === name);
            if (!output || job.status !== "succeeded") throw new Error("产物不存在");
            const bytes = readFileSync(join(jobs.directory(job.id), "outputs", output.name));
            if (hash(bytes) !== output.hash) throw new Error("产物校验失败");
            return new Response(Bun.file(join(jobs.directory(job.id), "outputs", output.name)), {
              headers: {
                ...headers,
                "Content-Disposition": `attachment; filename="${output.name}"`,
              },
            });
          }
          if (request.method !== "POST" || url.pathname !== "/rpc")
            return respond({ error: "Not found" }, 404);
          const body = (await request.json()) as { op?: unknown; input?: Record<string, unknown> };
          const input = body.input ?? {};
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new Error("input 必须是对象");
          if (typeof body.op !== "string") throw new Error("op 必须是字符串");
          return respond(service.call(body.op, input, urlFor));
        } catch (error) {
          return respond({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      },
    });
  } catch (error) {
    void jobs.close();
    void preview.stop(true);
    throw error;
  }
  return {
    api,
    preview,
    service,
    url: apiOrigin ?? `http://127.0.0.1:${api.port}`,
    projects,
    jobs,
    engine,
    async close() {
      // Keep health reachable until all children stop, so stop/start cannot race the state lease.
      await jobs.close();
      await Promise.all([api.stop(true), preview.stop(true)]);
    },
  };
}
function validHost(request: Request, port: number | undefined, publicOrigin?: string) {
  return [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    ...(publicOrigin ? [new URL(publicOrigin).host] : []),
  ].includes(request.headers.get("host") ?? "");
}
function httpOrigin(value: string) {
  const url = new URL(value);
  if (
    url.origin !== value ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("公开地址必须为完整 HTTP(S) origin，不含路径或凭据");
  return url.origin;
}
