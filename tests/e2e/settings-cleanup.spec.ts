import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings cleanup regression：
 * - 假设置/重复项不再出现
 * - 课程调色板在关闭自动配色时禁用
 * - 通知音量、专注自动免打扰、Kiro 发送方式/面板重置真实可操作
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("通用：侧栏重复行移除；关闭自动配色后调色板禁用", async ({ page }) => {
  await openSettings(page);
  const general = page.getByTestId("settings-general");
  await expect(general.locator('[data-setting-id="sidebar-default-collapsed"]')).toHaveCount(0);
  await expect(general.getByText("侧栏收起状态", { exact: true })).toHaveCount(0);

  const autoPalette = general.getByRole("switch", { name: "课程自动配色" });
  await expect(autoPalette).toBeVisible();
  if ((await autoPalette.getAttribute("aria-checked")) !== "false") {
    await autoPalette.click();
  }
  await expect(general.getByRole("button", { name: "管理课程调色板" })).toBeDisabled();
  await expect(general.getByText(/自动配色已关闭/)).toBeVisible();
});

test("任务与提醒：应用内提醒降级为说明，新增音量与专注自动免打扰", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("settings-view").getByRole("button", { name: "任务与提醒", exact: true }).click();
  const tasks = page.getByTestId("settings-tasks");
  await expect(tasks.getByText("临近截止范围", { exact: true })).toBeVisible();
  await expect(tasks.locator('[data-setting-id="in-app-reminders"]')).toHaveCount(0);
  await expect(tasks.getByText(/站内提醒始终开启/)).toBeVisible();
  await expect(tasks.getByText("提醒音量", { exact: true })).toBeVisible();
  await expect(tasks.getByLabel("提醒音量")).toBeVisible();
  await expect(tasks.getByText("专注期间自动免打扰", { exact: true })).toBeVisible();
});

test("Kiro：搜索服务状态合并；发送方式与面板重置可用", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("settings-view").getByRole("button", { name: "Kiro", exact: true }).click();
  const kiro = page.getByTestId("settings-kiro");
  await expect(kiro.getByText("发送方式", { exact: true })).toBeVisible();
  await expect(kiro.getByRole("button", { name: "重置面板" })).toBeVisible();
  await expect(kiro.locator('[data-setting-id="ai-connection-status"]')).toBeVisible();
  await expect(kiro.locator('[data-setting-id="kiro-web-search-service"]')).toHaveCount(0);

  await kiro.getByRole("button", { name: "搜索设置" }).click();
  await expect(kiro.locator('[data-setting-id="kiro-web-search-test"]')).toBeVisible();
  await expect(kiro.getByRole("button", { name: "测试连接" })).toHaveCount(2);
});
