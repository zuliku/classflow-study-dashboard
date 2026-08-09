import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Sidebar IA + Kiro 品牌（Task：Sidebar 信息架构重构）。
 * 验证：顺序（Kiro 独立 AI 区域在小组协作之后）、正式 Logo 统一（Sidebar/Rail/BottomNav）、
 * Featured Entry 结构（环 + active）、点击可用。
 */

test("Full Sidebar (xl)：Kiro 位于小组协作之后，使用正式 Logo，与设置分区", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const aside = page.locator("aside").first();
  // 顺序：学习统计 → 小组协作 → Kiro → 设置
  const labels = await aside.locator('[data-testid="nav-label"]').allTextContents();
  const mainIdx = labels.indexOf("小组协作");
  const kiroIdx = labels.indexOf("Kiro");
  const settingsIdx = labels.indexOf("设置");
  expect(mainIdx).toBeGreaterThanOrEqual(0);
  expect(kiroIdx).toBeGreaterThan(mainIdx);
  expect(settingsIdx).toBeGreaterThan(kiroIdx);
  expect(labels.indexOf("学习统计")).toBeLessThan(mainIdx);

  // Kiro entry：正式 Logo img + 高度 44px Featured 容器
  const kiroBtn = aside.getByRole("button", { name: "Kiro" });
  await expect(kiroBtn.locator('img[src="/kiro/kiro-mark.png"]')).toBeVisible();
  const box = await kiroBtn.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(45);
  expect(box!.height).toBeLessThanOrEqual(49);

  // 点击 → Workspace + active
  await kiroBtn.click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  await expect(kiroBtn).toHaveAttribute("aria-current", "page");
});

test("Icon Rail (md–xl)：Kiro 显示正式 Logo，tooltip 正常", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  const sidebar = page.locator("aside").first();
  const kiroRail = sidebar.getByRole("button", { name: "Kiro" });
  await expect(kiroRail.locator('img[src="/kiro/kiro-mark.png"]')).toBeVisible();
  // Logo 视觉中心与导航图标中心线一致
  const railBox = await sidebar.boundingBox();
  const kiroImg = await kiroRail.locator('img[src="/kiro/kiro-mark.png"]').boundingBox();
  expect(Math.abs(kiroImg!.x + kiroImg!.width / 2 - (railBox!.x + railBox!.width / 2))).toBeLessThanOrEqual(4);

  const tooltip = kiroRail.locator('[role="tooltip"]');
  await expect(tooltip).toHaveCSS("opacity", "0");
  await kiroRail.hover();
  await expect(tooltip).toHaveCSS("opacity", "1");
  await expect(tooltip).toContainText("Kiro");

  await kiroRail.click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
});

test("BottomNav (<768)：Kiro 使用正式 Logo（非 Sparkles）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const bottomNav = page.getByLabel("底部导航");
  const kiroItem = bottomNav.getByRole("button", { name: "Kiro" });
  await expect(kiroItem.locator('img[src="/kiro/kiro-mark.png"]')).toBeVisible();
  await expect(kiroItem.locator("svg")).toHaveCount(0); // 不再是 lucide 图标

  await kiroItem.click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
});

test("Kiro 内部品牌统一：Workspace Header / Empty State 均使用正式 Logo", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  await expect(page.getByTestId("kiro-workspace").locator('img[src="/kiro/kiro-mark.png"]').first()).toBeVisible();
  // Empty State KiroMark 也用正式 Logo
  await expect(page.getByTestId("kiro-empty").locator('img[src="/kiro/kiro-mark.png"]')).toBeVisible();
});
