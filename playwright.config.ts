import { defineConfig } from "@playwright/test";

/**
 * Playwright E2E（桌面 renderer http://localhost:5173，需本地 `npm run dev` 常驻）。
 * 约定见 AGENTS.md：依赖演示数据的 spec 用 tests/e2e/demoFixtures.ts 的 test；
 * 不依赖演示数据的 spec 用原生 @playwright/test。
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://localhost:5173",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
