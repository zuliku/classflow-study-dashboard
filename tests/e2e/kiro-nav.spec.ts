import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Kiro Workspace 导航与 UI 基础（Task 1）：
 * 1) Desktop Sidebar 进入 Kiro
 * 2) Tablet Icon Rail tooltip + 进入
 * 3) Mobile Bottom Nav Kiro 入口
 * 4) 未配置 AI 时的引导（不发送任何请求）
 * 5) Context / History UI foundation
 */

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
}

test("Desktop 1440：Sidebar 进入 Kiro，Empty State 与 Composer 可见，未配置时提示配置", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  const sidebar = page.locator("aside").first();
  const kiroNav = sidebar.getByRole("button", { name: "Kiro" });
  await expect(kiroNav).toBeVisible();
  await kiroNav.click();

  const ws = page.getByTestId("kiro-workspace");
  await expect(ws).toBeVisible();
  await expect(kiroNav).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("kiro-empty")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今天想先处理什么？" })).toBeVisible();

  const composer = page.getByTestId("kiro-composer");
  await expect(composer.getByLabel("Ask Kiro")).toBeVisible();
  await expect(composer.getByLabel("发送")).toBeDisabled();
  // 未配置 AI：提示 + 配置入口
  await expect(composer.getByText("先连接一个 AI 服务即可开始使用 Kiro。")).toBeVisible();
  // 点击建议不产生消息（未配置，禁止请求）
  await page.getByRole("button", { name: "帮我规划今天" }).first().click();
  await expect(page.getByTestId("kiro-user-message")).toHaveCount(0);

  // 配置 AI 服务 → 打开 Settings 的 Kiro section
  await composer.getByRole("button", { name: "配置 AI 服务" }).click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await expect(page.getByTestId("settings-kiro")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await expect(page.getByTestId("settings-view")).toHaveCount(0);

  // 无横向溢出
  expect(await hasHorizontalOverflow(page)).toBe(false);
});

test("Desktop：@ Context picker（UI foundation）与 History 空状态", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator("aside").first().getByRole("button", { name: "Kiro" }).click();
  const composer = page.getByTestId("kiro-composer");

  // @ → 课程上下文 chip（演示数据有课程；Task 2 起随消息发送）
  await composer.getByLabel("选择上下文").click();
  const picker = page.getByRole("dialog", { name: "选择上下文" });
  await expect(picker).toBeVisible();
  await picker.getByRole("menuitem", { name: /微观经济学/ }).first().click();
  // ContextBar 默认 collapsed：摘要显示主 Context（手动添加优先）
  await expect(page.getByTestId("kiro-context-bar")).toContainText("微观经济学");
  await page.getByTestId("kiro-context-bar").getByRole("button", { expanded: false }).click();
  await expect(page.getByTestId("kiro-context-bar")).toContainText("微观经济学");
  await expect(page.getByTestId("kiro-context-bar")).toContainText("本周");

  // Thread Rail：展开 → 空状态 + Esc 关闭（Desktop 历史入口已从 More 移入 Rail）
  await page.getByLabel("展开对话").click();
  const rail = page.getByRole("dialog", { name: "对话" });
  await expect(rail).toBeVisible();
  await expect(rail).toContainText("暂无历史对话");
  await page.keyboard.press("Escape");
  await expect(rail).toHaveCount(0);
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
});
