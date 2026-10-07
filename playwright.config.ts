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
  // CI 慢机防抖：仅 CI 加 1 次重试（本地保持 0，失败即显不掩盖；CI 绿才可信）。
  // webServer  intentionally 不配：renderer 依赖常驻 `npm run dev`（见 AGENTS.md），e2e 只在本地裸跑，CI 不跑 e2e。
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
