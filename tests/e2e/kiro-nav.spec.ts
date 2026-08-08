import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Workspace 导航与基础交互（Task 0，最小覆盖）：
 * 1) Desktop Sidebar 进入 Kiro
 * 2) Tablet Icon Rail tooltip + 进入
 * 3) Mobile Bottom Nav Kiro 入口
 * 4) Workspace 基础：Empty State / Composer / 发送 preview / 建议 / @ / 历史
 */

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
}

test("Desktop 1440：Sidebar 进入 Kiro Workspace，Empty State 与 Composer 可见", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const sidebar = page.locator("aside").first();
  const kiroNav = sidebar.getByRole("button", { name: "Kiro" });
  await expect(kiroNav).toBeVisible();
  await kiroNav.click();

  const ws = page.getByTestId("kiro-workspace");
  await expect(ws).toBeVisible();
  await expect(kiroNav).toHaveAttribute("aria-current", "page");
  // Empty State：有演示数据时显示数据类建议
  await expect(page.getByTestId("kiro-empty")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天想先处理什么？" })).toBeVisible();
  await expect(page.getByText("安排今天的任务")).toBeVisible();
  // Composer 基础控件
  const composer = page.getByTestId("kiro-composer");
  await expect(composer.getByLabel("Ask Kiro")).toBeVisible();
  await expect(composer.getByLabel("发送")).toBeDisabled();
  await expect(composer.getByLabel("添加附件")).toBeVisible();
  await expect(composer.getByLabel("选择上下文")).toBeVisible();
  await expect(composer.getByLabel("选择模型")).toBeVisible();
  // 无横向溢出
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test("Desktop：发送 preview message + 建议点击 + @ Context + 历史面板", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");

  // 建议点击 = 发送本地 preview
  await page.getByRole("button", { name: "查看最近 DDL" }).first().click();
  await expect(page.getByTestId("kiro-user-message")).toContainText("查看最近 DDL");
  await expect(page.getByTestId("kiro-message")).toContainText("Kiro 服务将在下一阶段接入");

  // 输入 → 发送 → 用户消息 + 占位回复
  await composer.getByLabel("Ask Kiro").fill("帮我看看今天的任务");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-user-message").last()).toContainText("帮我看看今天的任务");

  // @ → 课程上下文 chip（演示数据有课程）
  await composer.getByLabel("选择上下文").click();
  const picker = page.getByRole("dialog", { name: "选择上下文" });
  await expect(picker).toBeVisible();
  await picker.getByRole("menuitem", { name: /ECON/ }).first().click();
  await expect(page.getByTestId("kiro-context-bar")).toContainText("微观经济学");

  // 历史面板：打开 → Esc 关闭
  await page.getByLabel("历史记录").click();
  await expect(page.getByRole("dialog", { name: "历史记录" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "历史记录" })).toHaveCount(0);
});

test("Tablet 1024：Icon Rail 有 Kiro（tooltip），点击进入", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");

  const sidebar = page.locator("aside").first();
  const kiroRail = sidebar.getByRole("button", { name: "Kiro" });
  await expect(kiroRail).toBeVisible();
  const tooltip = kiroRail.locator('[role="tooltip"]');
  await expect(tooltip).toHaveCSS("opacity", "0");
  await kiroRail.hover();
  await expect(tooltip).toHaveCSS("opacity", "1");
  await expect(tooltip).toContainText("Kiro");

  await kiroRail.click();
  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test("Mobile 390：Bottom Nav 有 Kiro，进入后 Composer 可用且无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const nav = page.locator('nav[aria-label="底部导航"]');
  await expect(nav.getByRole("button", { name: "Kiro" })).toBeVisible();
  await nav.getByRole("button", { name: "Kiro" }).click();

  await expect(page.getByTestId("kiro-workspace")).toBeVisible();
  const composer = page.getByTestId("kiro-composer");
  await expect(composer.getByLabel("Ask Kiro")).toBeVisible();
  // Mobile Header 显示当前页名 Kiro
  await expect(page.locator("header h2").first()).toContainText("Kiro");
  // 无横向溢出
  expect(await hasHorizontalOverflow(page)).toBe(false);

  // 发送一条 preview
  await composer.getByLabel("Ask Kiro").fill("明天有什么安排");
  await composer.getByLabel("发送").click();
  await expect(page.getByTestId("kiro-user-message")).toContainText("明天有什么安排");
});
