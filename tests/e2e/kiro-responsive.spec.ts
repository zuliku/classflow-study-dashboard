import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Sidecar 响应式 smoke（Task 5）：
 *  ≥1536 Docked（静态列） / 1280–1535 Overlay（400px 右浮层） / 768–1279 Side Sheet / <768 Full-screen
 * 通过 Command Center handoff 打开 Sidecar 后测量 bounding box。
 */

async function openSidecar(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByLabel("命令中心搜索").fill("看看本周安排");
  await page.getByLabel("命令中心搜索").press("Enter");
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();
  await page.waitForTimeout(150);
}

const CASES: { name: string; width: number; height: number; expect: (b: { x: number; y: number; width: number; height: number }) => void }[] = [
  {
    name: "Docked ≥1536",
    width: 1600,
    height: 900,
    expect: (b) => {
      expect(b.x).toBe(1600 - b.width);
      expect(b.y).toBe(0);
      expect(b.height).toBeGreaterThanOrEqual(900);
    },
  },
  {
    name: "Overlay 1280–1535",
    width: 1366,
    height: 900,
    expect: (b) => {
      expect(b.width).toBe(400);
      expect(b.x).toBe(1366 - 400);
      expect(b.y).toBe(0);
    },
  },
  {
    name: "Side Sheet 768–1279",
    width: 1024,
    height: 900,
    expect: (b) => {
      expect(b.width).toBeLessThanOrEqual(420);
      expect(b.width).toBeGreaterThanOrEqual(400);
      expect(b.x).toBe(1024 - b.width);
      expect(b.y).toBe(0);
    },
  },
  {
    name: "Full-screen <768",
    width: 390,
    height: 844,
    expect: (b) => {
      expect(b.width).toBe(390);
      expect(b.height).toBe(844);
      expect(b.x).toBe(0);
      expect(b.y).toBe(0);
    },
  },
];

for (const c of CASES) {
  test(`Sidecar 响应式：${c.name}`, async ({ page }) => {
    await page.setViewportSize({ width: c.width, height: c.height });
    await openSidecar(page);
    const box = await page.getByTestId("kiro-sidecar").boundingBox();
    if (!box) throw new Error("sidecar 不可见");
    c.expect(box);
  });
}
