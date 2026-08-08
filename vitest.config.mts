import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  oxc: {
    // tsconfig 使用 jsx: preserve（Next 约定）；vitest 需要真实 JSX 转换
    jsx: { runtime: "automatic" },
  },
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
  },
});
