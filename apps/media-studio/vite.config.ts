import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  optimizeDeps: {
    // emscripten / onnxruntime 类模块不做 esbuild 预打包
    exclude: ["@sqlite.org/sqlite-wasm", "@huggingface/transformers"],
  },
  worker: {
    // transformers.js 在 worker 内动态 import 分包，需要 es 格式
    format: "es",
  },
  server: {
    // 端口固定：Cache API / OPFS 按 origin（含端口）隔离——
    // 模型权重与项目数据只在同一 origin 下跨会话保留
    port: 5180,
    strictPort: true,
    headers: {
      // §11：SharedArrayBuffer / cross-origin isolation 内置
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
