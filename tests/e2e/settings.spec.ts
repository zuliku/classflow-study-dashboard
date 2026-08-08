import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings Center E2E（精简版）：
 * 1) 导航（desktop 左栏 + mobile 横向 tabs）+ About 版本来源
 * 2) Profile dirty 代表流程（修改 → 未保存 → 放弃 → 恢复）
 * preferences 持久化 round-trip 由 unit 覆盖；产品影响由 preferences-behavior.spec 覆盖。
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("Settings Center：桌面导航与移动端 tabs 均可切换，About 版本来自 package.json", async ({ page }) => {
  await openSettings(page);

  // Desktop 左侧导航
  const nav = page.getByRole("navigation", { name: "设置导航" });
  await expect(page.getByTestId("settings-profile")).toBeVisible();
  await nav.getByRole("button", { name: "数据与存储" }).click();
  await expect(page.getByTestId("settings-data")).toBeVisible();
  await expect(page.getByText("导出 ZIP")).toBeVisible();
  await nav.getByRole("button", { name: "关于" }).click();
  await expect(page.getByTestId("settings-about")).toBeVisible();
  await expect(page.getByTestId("settings-about").getByText("ClassFlow", { exact: true })).toBeVisible();
  await expect(page.getByText("v2.4.0")).toHaveCount(0); // 不再有硬编码版本

  // Mobile 横向 tabs
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("navigation", { name: "设置导航" })).toBeHidden();
  await page.getByRole("button", { name: "学期与课表" }).click();
  await expect(page.getByTestId("settings-semester")).toBeVisible();
  await page.getByRole("button", { name: "任务与提醒" }).click();
  await expect(page.getByTestId("settings-tasks")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("Profile dirty：修改姓名 → 未保存 → 放弃更改 → 恢复原值", async ({ page }) => {
  await openSettings(page);
  const nameInput = page.getByTestId("settings-profile").getByLabel("姓名");
  const original = await nameInput.inputValue();

  await nameInput.fill("新名字测试");
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("有未保存的更改");

  await page.getByRole("button", { name: "放弃更改" }).click();
  await expect(nameInput).toHaveValue(original);
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("已保存");
  await expect(page.getByRole("button", { name: "放弃更改" })).toHaveCount(0);
});
