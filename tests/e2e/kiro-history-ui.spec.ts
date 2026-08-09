import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * 三项 UI 修复验证（测试简化）：
 * 1. History Panel full-height（顶部无空隙 / 底部无空隙 / border-l 连续）
 * 2. KiroMark 无方形容器（Logo 直接展示，光学尺寸）
 * 3. Sidebar Kiro Featured 无左侧黑线（active 用 pastel-mint + 静态 ring）
 */

const AI_SETTINGS = {
  enabled: true,
  provider: "deepseek",
  model: "deepseek-v4-flash",
  custom: { providerName: "", baseURL: "", model: "" },
};

test("History Panel：从 Header 下沿连续延伸到 Workspace 底部，border-l 不断线", async ({ page }) => {
  await page.addInitScript(({ settings, key }) => {
    localStorage.setItem("classflow-ai-settings-v1", JSON.stringify({ version: 0, state: settings }));
    sessionStorage.setItem("classflow-ai-key:deepseek", key);
  }, { settings: AI_SETTINGS, key: "sk-test-key" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  // 打开历史面板
  await page.getByLabel("更多操作", { exact: true }).click();
  await page.getByRole("menuitem", { name: "历史记录" }).click();
  const panel = page.getByRole("dialog", { name: "历史记录" });
  await expect(panel).toBeVisible();

  const globalHeader = page.locator("header").first();
  const pBox = await panel.boundingBox();
  const hBox = await globalHeader.boundingBox();
  const mainBox = await page.locator("main").boundingBox();

  // 顶部：面板顶 == 全局 Header 底（无空隙）
  expect(Math.abs(pBox!.y - (hBox!.y + hBox!.height))).toBeLessThanOrEqual(1);
  // 底部：面板底 == main 内容区底（接近 viewport 底，无空隙）
  expect(Math.abs(pBox!.y + pBox!.height - (mainBox!.y + mainBox!.height))).toBeLessThanOrEqual(1);
  expect(pBox!.y + pBox!.height).toBeGreaterThan(880);
  // 宽度 ≈ 320（含 1px border-l）
  expect(pBox!.width).toBeGreaterThanOrEqual(319);
  expect(pBox!.width).toBeLessThanOrEqual(321);
  // 内容区不为 History 覆盖：Composer 右缘 ≤ 面板左缘
  const composer = page.getByTestId("kiro-composer");
  const cBox = await composer.boundingBox();
  expect(cBox!.x + cBox!.width).toBeLessThanOrEqual(pBox!.x + 1);

  // 打开/关闭无残留：内容恢复全宽
  await panel.getByLabel("关闭历史记录").click();
  await expect(panel).toHaveCount(0);
  const cBox2 = await composer.boundingBox();
  expect(cBox2!.x + cBox2!.width).toBeGreaterThan(pBox!.x);
});

test("KiroMark：无方形容器，Logo 直接展示（光学尺寸 28px）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();

  // Workspace Header 的 Kiro Logo：直接 img，无背景 / 无边框 / 无圆角
  const mark = page.getByTestId("kiro-workspace").locator('img[src="/kiro/kiro-mark.png"]').first();
  await expect(mark).toBeVisible();
  const info = await mark.evaluate((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return { w: box.width, h: box.height, bg: cs.backgroundColor, radius: cs.borderRadius };
  });
  expect(info.w).toBeCloseTo(28, 0);
  expect(info.h).toBeCloseTo(28, 0);
  expect(info.bg).toBe("rgba(0, 0, 0, 0)");
  expect(info.radius).toBe("0px");

  // Empty State 也用大号 Logo（40px）无背景
  const emptyMark = page.getByTestId("kiro-empty").locator('img[src="/kiro/kiro-mark.png"]');
  const eBox = await emptyMark.boundingBox();
  expect(eBox!.width).toBeCloseTo(40, 0);
});

test("Sidebar Kiro Active：无左侧黑线（active = pastel-mint + 静态品牌环）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();

  const kiroBtn = page.locator("aside").first().getByRole("button", { name: "Kiro" });
  await expect(kiroBtn).toHaveAttribute("aria-current", "page");
  // 无黑色左侧指示条（rounded-full + bg-charcoal 组合只属于旧 indicator）
  await expect(kiroBtn.locator("span.rounded-full.bg-charcoal")).toHaveCount(0);
  // active：pastel-mint 内容层 + 静态 ring（动画层 active 时隐藏）
  const content = kiroBtn.locator("span.relative");
  await expect(content).toHaveCSS("background-color", "rgb(227, 230, 224)"); // pastel-mint
  await expect(kiroBtn.locator(".kiro-ring-animated:visible")).toHaveCount(0);

  // 普通导航保留左侧黑线
  const overviewBtn = page.locator("aside").first().getByRole("button", { name: "总览" });
  await overviewBtn.click();
  await expect(overviewBtn.locator("span.rounded-full.bg-charcoal")).toHaveCount(1);
});
