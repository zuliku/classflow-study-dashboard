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

  // 默认 section 是通用
  const nav = page.getByRole("navigation", { name: "设置导航" });
  await expect(page.getByTestId("settings-general")).toBeVisible();

  // Desktop 左侧导航
  await nav.getByRole("button", { name: "个人资料" }).click();
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
  await page.getByTestId("settings-view").getByRole("button", { name: "任务", exact: true }).click();
  await expect(page.getByTestId("settings-tasks")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("Settings Search：Cmd+F → 输入「截止」→ 跳转默认截止时间 → 修改后已修改计数增加", async ({ page }) => {
  await openSettings(page);

  // 默认 section 是通用
  await expect(page.getByTestId("settings-general")).toBeVisible();

  // Cmd/Ctrl+F 聚焦设置搜索（Modal 打开时拦截）
  await page.keyboard.press("Control+f");
  const searchInput = page.getByRole("textbox", { name: "搜索设置" });
  await expect(searchInput).toBeFocused();
  await searchInput.fill("截止");

  // 搜索结果：默认截止时间
  await expect(page.getByTestId("settings-search-results")).toContainText("默认截止时间");
  await expect(page.getByTestId("settings-search-results")).toContainText("临近截止提醒");

  // 点击「默认截止时间」→ 跳到任务 section + target row 存在
  await page.getByTestId("settings-search-results").getByText("默认截止时间", { exact: true }).click();
  await expect(page.getByTestId("settings-tasks")).toBeVisible();
  await expect(page.locator('[data-setting-id="default-ddl-time"]')).toBeVisible();

  // 修改默认截止时间 → 已修改计数增加
  const timeInput = page.getByTestId("settings-tasks").locator("input[type='time']");
  await timeInput.fill("21:00");
  await expect(timeInput).toHaveValue("21:00");
  // 已修改视图：任务 section 出现该行，可单项恢复默认
  await page.getByTestId("settings-view").getByRole("button", { name: /已修改/ }).first().click();
  await expect(page.getByTestId("settings-modified")).toBeVisible();
  await expect(page.getByTestId("settings-modified")).toContainText("默认截止时间");
  await page.getByLabel("将默认截止时间恢复默认").click();
  await expect(page.getByTestId("settings-tasks").locator("input[type='time']")).toHaveValue("23:59");
  // 恢复后无已修改项：回到普通视图，「已修改」无数字
  await expect(page.getByTestId("settings-modified")).toHaveCount(0);
});

test("Profile dirty：修改姓名 → 未保存 → 放弃更改 → 恢复原值", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "个人资料" }).click();
  await expect(page.getByTestId("settings-profile")).toBeVisible();
  const nameInput = page.getByTestId("settings-profile").getByLabel("姓名");
  const original = await nameInput.inputValue();

  await nameInput.fill("新名字测试");
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("有未保存的更改");

  await page.getByRole("button", { name: "放弃更改" }).click();
  await expect(nameInput).toHaveValue(original);
  await expect(page.getByTestId("settings-profile").getByTestId("settings-save-status")).toContainText("已保存");
  await expect(page.getByRole("button", { name: "放弃更改" })).toHaveCount(0);
});
