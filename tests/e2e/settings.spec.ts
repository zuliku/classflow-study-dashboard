import { test, expect, Page } from "@playwright/test";

/**
 * Settings Center E2E：导航切换、移动端 tabs、preference 持久化、Profile dirty 保存流。
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("Desktop：设置导航切换 section，Detail 正确更新", async ({ page }) => {
  await openSettings(page);
  const nav = page.getByRole("navigation", { name: "设置导航" });

  // 个人资料（默认）
  await expect(page.getByTestId("settings-profile")).toBeVisible();
  await expect(page.getByText("基本资料")).toBeVisible();

  // 学期与课表
  await nav.getByRole("button", { name: "学期与课表" }).click();
  await expect(page.getByTestId("settings-semester")).toBeVisible();
  await expect(page.getByText("第一周开始日期", { exact: true })).toBeVisible();

  // 数据与存储
  await nav.getByRole("button", { name: "数据与存储" }).click();
  await expect(page.getByTestId("settings-data")).toBeVisible();
  await expect(page.getByText("导出备份 ZIP")).toBeVisible();

  // 关于：版本来自 package.json（无硬编码 v2.4.0）
  await nav.getByRole("button", { name: "关于" }).click();
  await expect(page.getByTestId("settings-about")).toBeVisible();
  await expect(page.getByTestId("settings-about").getByText("ClassFlow", { exact: true })).toBeVisible();
  await expect(page.getByTestId("settings-about").getByText("IndexedDB")).toBeVisible();
  await expect(page.getByText("v2.4.0")).toHaveCount(0);
});

test("Preference persist：切换偏好后刷新保持", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "交互与外观" }).click();

  // 关闭「显示周末」开关
  await page.getByRole("switch", { name: "显示周末" }).click();
  await expect(page.getByRole("switch", { name: "显示周末" })).toHaveAttribute("aria-checked", "false");

  // 刷新后保持（preferences 持久化）
  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "交互与外观" }).click();
  await expect(page.getByRole("switch", { name: "显示周末" })).toHaveAttribute("aria-checked", "false");
});

test("Profile dirty：修改姓名 → 显示未保存 → 放弃更改 → 恢复原值", async ({ page }) => {
  await openSettings(page);

  const nameInput = page.getByTestId("settings-profile").getByLabel("姓名");
  const original = await nameInput.inputValue();

  await nameInput.fill("新名字测试");
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("有未保存的更改");

  // 放弃更改 → 恢复原值，回到已保存状态
  await page.getByRole("button", { name: "放弃更改" }).click();
  await expect(nameInput).toHaveValue(original);
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("已保存");
  await expect(page.getByRole("button", { name: "放弃更改" })).toHaveCount(0);
});

test("Profile dirty：修改姓名 → 保存 → toast 且刷新后保持", async ({ page }) => {
  await openSettings(page);
  const nameInput = page.getByTestId("settings-profile").getByLabel("姓名");
  await nameInput.fill("设置保存测试");
  await page.getByRole("button", { name: "保存" }).click();

  await expect(page.getByText("设置已保存").first()).toBeVisible();
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("已保存");

  await page.reload();
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-profile").getByLabel("姓名")).toHaveValue("设置保存测试");
});

test("Mobile 390：横向 tabs 导航可访问、切换正常、无横向 overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // 底部导航「更多」菜单 → 设置
  await page.locator('nav[aria-label="底部导航"]').getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设置" }).click();
  await expect(page.getByTestId("settings-view")).toBeVisible();

  // 桌面左侧导航隐藏，移动端 tabs 可用
  await expect(page.getByRole("navigation", { name: "设置导航" })).toBeHidden();
  await page.getByRole("button", { name: "数据与存储" }).click();
  await expect(page.getByTestId("settings-data")).toBeVisible();
  await page.getByRole("button", { name: "关于" }).click();
  await expect(page.getByTestId("settings-about")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});
