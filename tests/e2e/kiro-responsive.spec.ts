import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Sidecar 响应式 smoke（Task 5）：
 *  ≥1536 Docked（静态列） / 1280–1535 Overlay（400px 右浮层） / 768–1279 Side Sheet / <768 Full-screen
 * 通过 Command Center handoff 打开 Sidecar 后测量 bounding box。
 */

async function openSidecar(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "总览" }).first()).toBeVisible({ timeout: 15000 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.getByLabel("命令中心搜索").fill("看看本周安排");
  await page.getByLabel("命令中心搜索").press("Enter");
  await expect(page.getByTestId("kiro-sidecar")).toBeVisible();
  await page.waitForTimeout(150);
}

const CASES: { name: string; width: number; height: number; expect: (b: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }) => void }[] = [
  ...([1600, 1366, 1024] as const).map((width) => ({
    name: `Desktop ${width}：浮动 Sidecar（默认 620×760 + 安全边距）`,
    width,
    height: 900,
    expect: (b: { x: number; y: number; width: number; height: number }, viewport: { width: number; height: number }) => {
      // Sidecar 已统一为可移动/可缩放的浮动壳体（默认 620×760），不再按断点切固定宽度
      // Sidecar 已统一为可移动/可缩放的浮动壳体（默认 620×760），不按断点切固定宽度。
      // 受 devicePixelRatio / 缩放影响，允许几个像素误差。
      expect(b.width).toBeGreaterThanOrEqual(600);
      expect(b.width).toBeLessThanOrEqual(640);
      expect(b.height).toBeGreaterThanOrEqual(740);
      expect(b.height).toBeLessThanOrEqual(780);
      const rightGap = viewport.width - (b.x + b.width);
      expect(rightGap).toBeGreaterThanOrEqual(22);
      expect(rightGap).toBeLessThanOrEqual(26);
      expect(b.y).toBeGreaterThanOrEqual(38);
      expect(b.y).toBeLessThanOrEqual(42);
    },
  })),
  {
    name: "Full-screen <768",
    width: 390,
    height: 844,
    expect: (b, viewport) => {
      // 全屏无浮动边距；允许 1px 内的滚动条/小数误差
      expect(Math.abs(b.width - viewport.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.height - viewport.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y)).toBeLessThanOrEqual(1);
    },
  },
];

for (const c of CASES) {
  test(`Sidecar 响应式：${c.name}`, async ({ page }) => {
    await page.setViewportSize({ width: c.width, height: c.height });
    await openSidecar(page);
    const box = await page.getByTestId("kiro-sidecar").boundingBox();
    if (!box) throw new Error("sidecar 不可见");
    c.expect(box, { width: c.width, height: c.height });
  });
}
