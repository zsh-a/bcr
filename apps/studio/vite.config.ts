import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type ProxyOptions } from "vite-plus";
import type { IncomingMessage, ServerResponse } from "node:http";

// Keep the build timestamp in the service-worker source itself. A deployment
// with unchanged application chunks must still produce different sw.js bytes,
// otherwise an installed PWA has no signal that a new release is available.
const readerBuildId = String(Date.now());

// Explicit opt-in: never turn a static/public deployment into an open LLM proxy.
const localGateway = process.env.BCR_LOCAL_LLM === "1";
function guardLocalGateway(req: IncomingMessage, res: ServerResponse | undefined) {
  if (!res) return false;
  const host = req.headers.host ?? "";
  const origin = req.headers.origin;
  if (
    !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) ||
    (origin !== undefined && origin !== `http://${host}` && origin !== `https://${host}`) ||
    req.headers["sec-fetch-site"] === "cross-site" ||
    !(
      (req.method === "POST" && req.url === "/api/llm/v1/chat/completions") ||
      (req.method === "GET" && req.url === "/api/llm/v1/models")
    )
  ) {
    res.writeHead(403).end("Local gateway request denied");
    return req.url ?? "/api/llm";
  }
}
const gatewayProxy: Record<string, ProxyOptions> = localGateway
  ? {
      "/api/llm": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        bypass: guardLocalGateway,
        rewrite: (path: string) => path.replace(/^\/api\/llm/, ""),
      },
    }
  : {};

export default defineConfig({
  plugins: [tailwindcss(), react()],
  preview: { proxy: gatewayProxy },
  define: {
    "globalThis.__BCR_READER_BUILD_ID__": JSON.stringify(readerBuildId),
  },
  build: {
    // The service worker reads this stable manifest at install time to
    // precache the hashed Reader entry graph without hard-coding filenames.
    manifest: "build-manifest.json",
    rolldownOptions: {
      input: {
        index: new URL("./index.html", import.meta.url).pathname,
        "service-worker": new URL("./src/service-worker.js", import.meta.url).pathname,
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "service-worker" ? "sw.js" : "assets/[name]-[hash].js",
      },
    },
  },
  optimizeDeps: {
    // emscripten / onnxruntime 类模块不做 esbuild 预打包；wasm 路径由 locateFile 注入
    exclude: ["@duckdb/duckdb-wasm", "@sqlite.org/sqlite-wasm", "@huggingface/transformers"],
  },
  worker: {
    // transformers.js 在 worker 内动态 import 分包，需要 es 格式
    format: "es",
  },
  server: {
    proxy: gatewayProxy,
    // 持久化走查与 OPFS origin 固定，避免端口漂移导致缓存/项目不可见。
    port: 5199,
    strictPort: true,
    headers: {
      // §11：credentialless 保留 SharedArrayBuffer 隔离，同时允许行情 SDK 的 JSONP 搜索脚本。
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    },
  },
});
