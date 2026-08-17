import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V3 Task 3 — 默认任务视图（defaultTaskWorkspaceView）行为 E2E：
 * 验证「设置改变后实际业务行为发生变化」——不是只测 switch 本身。
 * 消费链路：Settings → AppPreferences（persist）→ 启动校正 seed assignmentWorkspaceView。
 */

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务工作区" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
}

test("默认任务视图未修改 → 任务工作区默认激活「聚焦」", async ({ page }) => {
  await openWorkspace(page);
  const focusTab = page.getByTestId("assignments-tab").getByRole("button", { name: /^聚焦/ });
  await expect(focusTab).toHaveAttribute("aria-pressed", "true");
});

test("默认任务视图 = 今天 → reload 后任务工作区默认激活「今天」", async ({ page }) => {
  // 1. 设置默认任务视图 = 今天
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByTestId("settings-view").getByRole("button", { name: "任务与提醒", exact: true }).click();

  const group = page.getByRole("group", { name: "默认任务视图" });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "今天" }).click();
  await expect(group.getByRole("button", { name: "今天" })).toHaveAttribute("aria-pressed", "true");

  // 2. 关闭设置并 reload（preference 已持久化；demoFixtures 只在首次导航注入）
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await page.reload();

  // 3. 打开任务工作区：默认视图应为「今天」（启动校正消费 preference）
  await openWorkspace(page);
  const todayTab = page.getByTestId("assignments-tab").getByRole("button", { name: /^今天/ });
  await expect(todayTab).toHaveAttribute("aria-pressed", "true");
  const focusTab = page.getByTestId("assignments-tab").getByRole("button", { name: /^聚焦/ });
  await expect(focusTab).not.toHaveAttribute("aria-pressed", "true");
});
