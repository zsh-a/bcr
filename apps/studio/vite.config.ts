import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    // The service worker reads this stable manifest at install time to
    // precache the hashed Reader entry graph without hard-coding filenames.
    manifest: "build-manifest.json",
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
