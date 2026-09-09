import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    // 端口固定，与其它 app 错开（5180/5181/5199/5200/5201/5202 已占用）
    port: 5209,
    strictPort: true,
    headers: {
      // 与 media-studio 一致：SharedArrayBuffer / cross-origin isolation 内置
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
