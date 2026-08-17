import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * UISelect 可读性回归（Settings/Select Final Fix）：
 * - 窄 trigger（任务状态）打开后菜单更宽、普通 label 完整显示（无「待...」截断）
 * - 长 label（跟随系统/完整动效）完整显示
 * - 菜单不显示系统滚动条（scrollbar-none）
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("窄 trigger（任务状态）：菜单宽于 trigger，label 完整显示", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务工作区" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
  await page.locator('[data-assignment-id="a1"]').first().click();
  await expect(page.getByRole("button", { name: "关闭", exact: true }).first()).toBeVisible();

  const trigger = page.getByRole("combobox", { name: "任务状态" });
  await expect(trigger).toBeVisible();
  const triggerBox = await trigger.boundingBox();
  await trigger.click();

  const listbox = page.getByRole("listbox", { name: "任务状态" });
  await expect(listbox).toBeVisible();
  const menuBox = await listbox.boundingBox();
  // 菜单比窄 trigger 宽（解耦后至少 min-width 168）
  expect(menuBox!.width).toBeGreaterThan(triggerBox!.width);

  // 普通 label 完整可见（无省略号）
  for (const label of ["待完成", "进行中", "已完成"]) {
    const opt = listbox.getByRole("option", { name: label, exact: true });
    await expect(opt).toBeVisible();
    expect(await opt.textContent()).toBe(label);
  }
  // 菜单无滚动条视觉（scrollbar-none）
  await expect(listbox).toHaveClass(/scrollbar-none/);
});

test("长 label（动效偏好）：跟随系统 / 完整动效 / 减少动效完整显示", async ({ page }) => {
  await openSettings(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "通用" })
    .click();
  const trigger = page.getByRole("combobox", { name: "动效偏好" });
  await trigger.click();
  const listbox = page.getByRole("listbox", { name: "动效偏好" });
  await expect(listbox).toBeVisible();
  for (const label of ["跟随系统", "完整动效", "减少动效"]) {
    const opt = listbox.getByRole("option", { name: label, exact: true });
    await expect(opt).toBeVisible();
    expect(await opt.textContent()).toBe(label);
  }
  await page.keyboard.press("Escape");
  await expect(listbox).toHaveCount(0);
});
