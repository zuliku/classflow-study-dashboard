import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["vitest.setup.ts"],
    // 全量并行跑 145+ 文件时，重 IO/真实 ConPTY/docx fixture 用例在默认 5s 下会被
    // CPU 争用误杀（单独运行均 <3s）。放宽全局上限，消除 CI gate 偶发 flake。
    testTimeout: 20000,
    hookTimeout: 20000,
    // 全量收集：显式文件清单已严重漂移（219 个测试文件从未被执行），改为 glob 防止再次漂移。
    // Live-provider smoke 自带环境变量 skip 守卫；Playwright E2E（*.spec.ts）不在 vitest 范围。
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "scripts/docx-compat/generate-fixtures.test.ts",
    ],
  },
});
