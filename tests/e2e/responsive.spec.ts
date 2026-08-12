import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/** viewport 无横向溢出：documentElement.scrollWidth 不超出可视宽度 */
async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
}

test.describe("responsive navigation", () => {
  test("desktop 1440: 完整 Sidebar 可见，Bottom Nav 不存在", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();

    // 完整 Sidebar：宽度 > 150px（Icon Rail 仅为 64px）
    const box = await sidebar.boundingBox();
    expect(box!.width).toBeGreaterThan(150);

    // Workspace Header：总览 title + 全局搜索可达
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();

    // 导航文字标签可见（Icon Rail 模式下隐藏）
    await expect(
      sidebar.locator('[data-testid="nav-label"]', { hasText: "任务与 DDL" })
    ).toBeVisible();
    await expect(
      sidebar.locator('[data-testid="nav-label"]', { hasText: "小组协作" })
    ).toBeVisible();

    // Bottom Nav 不存在
    await expect(page.locator('nav[aria-label="底部导航"]')).toBeHidden();

    // 无横向溢出
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("tablet 1024: Icon Rail 可见，主内容无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto("/");

    const sidebar = page.locator("aside").first();
    await expect(sidebar).toBeVisible();

    // Icon Rail：宽度 ≤ 72px，仅图标
    const box = await sidebar.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(72);

    // Workspace Header：总览 title + 全局搜索可达
    await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
    await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();

    await expect(
      sidebar.locator('[data-testid="nav-label"]', { hasText: "任务与 DDL" })
    ).toBeHidden();

    // Hover 显示 tooltip
    const railButton = sidebar.getByRole("button", { name: "时间表" });
    const tooltip = railButton.locator('[role="tooltip"]');
    await expect(tooltip).toHaveCSS("opacity", "0");
    await railButton.hover();
    await expect(tooltip).toHaveCSS("opacity", "1");
    await expect(tooltip).toContainText("时间表");

    // 主内容无横向 viewport overflow
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("mobile 390: Sidebar 隐藏，Bottom Nav 可见，可切换页面且不遮挡内容", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    // Sidebar 不存在
    await expect(page.locator("aside").first()).toBeHidden();

    // Bottom Nav 可见
    const nav = page.locator('nav[aria-label="底部导航"]');
    await expect(nav).toBeVisible();

    // 主内容底部留白，避免最后一行被 Bottom Nav 遮挡
    // （App Shell 结构：main 无 padding，底部留白由页面 body 容器承担——hero/secondary 为 section）
    const bodyPadding = await page
      .locator("main > div > div > div, main > div > div > section")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
    expect(bodyPadding).toBeGreaterThanOrEqual(80);

    // 无横向溢出
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // 切换主要页面
    await nav.getByRole("button", { name: "任务" }).click();
    await expect(page.getByRole("heading", { name: "任务与 DDL" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "全局搜索" })).toBeVisible();

    await nav.getByRole("button", { name: "时间表" }).click();
    await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();

    // 更多菜单 → 课程（已移入「更多」）
    await nav.getByRole("button", { name: "更多" }).click();
    await page.getByRole("menuitem", { name: "课程" }).click();
    await expect(page.getByRole("heading", { name: "课程资料" })).toBeVisible();

    // 更多菜单 → 设置（全屏 Modal）
    await nav.getByRole("button", { name: "更多" }).click();
    await expect(page.getByRole("menuitem", { name: "设置" })).toBeVisible();
    await page.getByRole("menuitem", { name: "设置" }).click();
    await expect(page.getByTestId("settings-view")).toBeVisible();

    // 关闭设置 Modal 后回到底部导航
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-view")).toHaveCount(0);

    // 回到总览
    await nav.getByRole("button", { name: "总览" }).click();
    await expect(page.getByRole("heading", { name: "本周课表" })).toBeVisible();

    // 切换后仍无横向溢出
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
