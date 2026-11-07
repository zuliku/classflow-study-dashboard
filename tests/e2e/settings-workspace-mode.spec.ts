import { expect } from "@playwright/test";
import { test } from "./demoFixtures";
import type { Page } from "@playwright/test";

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("设置：时间表样式可切换计划画布 / 经典时间表", async ({ page }) => {
  await openSettings(page);
  const general = page.getByTestId("settings-general");
  const row = general.locator('[data-setting-id="timetable-mode"]');
  await expect(row).toBeVisible();

  await row.getByRole("button", { name: "经典时间表" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);

  await page.getByRole("button", { name: "时间表", exact: true }).first().click();
  await page.waitForTimeout(700);
  await expect(page.getByTestId("timeline-key-lane").first()).toBeVisible();
  await expect(page.getByTestId("plan-workspace")).toHaveCount(0);

  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page
    .getByTestId("settings-general")
    .locator('[data-setting-id="timetable-mode"]')
    .getByRole("button", { name: "计划画布" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);

  await page.getByRole("button", { name: "时间表", exact: true }).first().click();
  await page.waitForTimeout(700);
  await expect(page.getByTestId("plan-workspace")).toBeVisible();
  await expect(page.getByTestId("timeline-key-lane")).toHaveCount(0);
});

test("设置：关闭今日页面后隐藏入口并回落到总览", async ({ page }) => {
  await openSettings(page);
  const toggle = page
    .getByTestId("settings-general")
    .locator('[data-setting-id="today-workspace-enabled"]')
    .getByRole("switch", { name: "启用今日页面" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "总览" })).toBeVisible();
  await expect(page.locator('[aria-label="今天"]')).toHaveCount(0);

  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  const toggleAgain = page
    .getByTestId("settings-general")
    .locator('[data-setting-id="today-workspace-enabled"]')
    .getByRole("switch", { name: "启用今日页面" });
  await toggleAgain.click();
  await expect(toggleAgain).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator('[aria-label="今天"]').first()).toBeVisible();
});

test("设置：移动端关闭今日页面后底部导航同步隐藏", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(page.getByTestId("settings-view")).toBeVisible();

  const toggle = page
    .getByTestId("settings-general")
    .locator('[data-setting-id="today-workspace-enabled"]')
    .getByRole("switch", { name: "启用今日页面" });
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "今天", exact: true })).toHaveCount(0);
});
