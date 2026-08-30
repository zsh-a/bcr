import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["{packages,apps}/*/tests/**/*.test.ts"],
  },
});
