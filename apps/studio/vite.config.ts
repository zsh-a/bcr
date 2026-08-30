import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  optimizeDeps: {
    // emscripten 模块不做 esbuild 预打包；wasm 路径由 locateFile 注入
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  server: {
    headers: {
      // §11：SharedArrayBuffer / cross-origin isolation 内置
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
