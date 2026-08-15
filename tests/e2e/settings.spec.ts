import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings Center E2E（精简版）：
 * 1) 导航（desktop 左栏 + mobile 横向 tabs）+ About 版本来源
 * 2) Profile dirty 代表流程（修改 → 未保存 → 放弃 → 恢复）
 * 3) 搜索（Cmd/Ctrl+F 聚焦侧栏搜索框 → 结果 → 跳转 + 高亮 + 清空搜索）
 * 4) 单项恢复默认（row-level reset；无「已修改 N」全局视图）
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
  await nav.getByRole("button", { name: "数据与隐私" }).click();
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
  await page.getByTestId("settings-view").getByRole("button", { name: "任务与提醒", exact: true }).click();
  await expect(page.getByTestId("settings-tasks")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("Settings Search：Cmd+F → 输入「截止」→ 跳转默认截止时间 → 修改 → 单项恢复默认", async ({ page }) => {
  await openSettings(page);

  // 默认 section 是通用
  await expect(page.getByTestId("settings-general")).toBeVisible();

  // Cmd/Ctrl+F 聚焦侧栏搜索框（Modal 打开时拦截浏览器默认 find）
  await page.keyboard.press("Control+f");
  const searchInput = page.getByRole("textbox", { name: "搜索设置" });
  await expect(searchInput).toBeFocused();
  await searchInput.fill("截止");

  // 搜索结果：默认截止时间
  await expect(page.getByTestId("settings-search-results")).toContainText("默认截止时间");
  await expect(page.getByTestId("settings-search-results")).toContainText("临近截止提醒");

  // 点击「默认截止时间」→ 跳到任务 section + 搜索清空 + target row 存在
  await page.getByTestId("settings-search-results").getByText("默认截止时间", { exact: true }).click();
  await expect(page.getByTestId("settings-tasks")).toBeVisible();
  await expect(searchInput).toHaveValue("");
  await expect(page.locator('[data-setting-id="default-ddl-time"]')).toBeVisible();
  // 跳转目标收到高亮（短暂闪烁）
  await expect(page.locator('[data-setting-id="default-ddl-time"]')).toHaveClass(/bg-pastel-mint/);

  // 修改默认截止时间 → 行内出现「恢复默认」，点击后回到默认值（无「已修改 N」全局视图）
  const timeInput = page.getByTestId("settings-tasks").locator("input[type='time']");
  await timeInput.fill("21:00");
  await expect(timeInput).toHaveValue("21:00");
  await page.getByLabel("将默认截止时间恢复默认").click();
  await expect(timeInput).toHaveValue("23:59");
  await expect(page.getByTestId("settings-modified")).toHaveCount(0);
  await expect(page.getByTestId("settings-view").getByRole("button", { name: /已修改/ })).toHaveCount(0);
});

test("Settings Search：搜索「姓名」→ 跳到个人资料 section（profile 字段已入 Registry）", async ({ page }) => {
  await openSettings(page);
  await page.keyboard.press("Control+f");
  await page.getByRole("textbox", { name: "搜索设置" }).fill("姓名");
  await expect(page.getByTestId("settings-search-results")).toContainText("姓名");
  await page.getByTestId("settings-search-results").getByText("姓名", { exact: true }).click();
  await expect(page.getByTestId("settings-profile")).toBeVisible();
  await expect(page.locator('[data-setting-id="profile-name"]')).toBeVisible();
});

test("Settings Search：Modal 关闭时不劫持 Ctrl+F，打开后搜索框常驻侧栏", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  });

  // Modal 未打开：页面上不存在搜索框（也没有隐藏搜索状态）
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toHaveCount(0);

  await page.getByRole("button", { name: "设置" }).first().click();

  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  // 打开后搜索框常驻侧栏且未聚焦（Ctrl+F 未被劫持到本测试的 dispatch 之外）
  const searchInput = page.getByRole("textbox", { name: "搜索设置" });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).not.toBeFocused();
});

test("Settings Modal：关闭后焦点回到打开按钮", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "设置" }).first();
  await trigger.focus();
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(trigger).toBeFocused();
});

test("Settings Modal：搜索框有内容时 Esc 先清空搜索，再按一次才关闭", async ({ page }) => {
  await openSettings(page);
  const searchInput = page.getByRole("textbox", { name: "搜索设置" });
  await searchInput.fill("备份");
  await expect(page.getByTestId("settings-search-results")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(searchInput).toHaveValue("");
  await expect(page.getByTestId("settings-search-results")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "设置" })).toHaveCount(0);
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

test("Settings Layout：侧栏搜索常驻 + 左栏导航稳定且不与内容重叠", async ({ page }) => {
  await openSettings(page);

  const dialog = page.getByRole("dialog", { name: "设置" });
  const nav = page.getByRole("navigation", { name: "设置导航" });
  const detail = page.getByTestId("settings-detail");
  const searchInput = page.getByRole("textbox", { name: "搜索设置" });

  await expect(searchInput).toBeVisible();
  await expect(detail).toBeVisible();
  await expect(dialog).toHaveCSS("opacity", "1");

  // 左栏导航与 Detail 不重叠（导航右缘 <= Detail 左缘）
  const n = await nav.boundingBox();
  expect(n).not.toBeNull();
  const d = await detail.boundingBox();
  expect(d).not.toBeNull();
  expect(n!.x + n!.width).toBeLessThanOrEqual(d!.x + 1);

  // 连续切换 3 个 section：左栏 x/y/width 不变
  const first = n!;
  for (const label of ["个人资料", "任务", "数据与隐私"]) {
    await nav.getByRole("button", { name: label }).click();
    const box = await nav.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(first.x, 0);
    expect(box!.y).toBeCloseTo(first.y, 0);
    expect(box!.width).toBeCloseTo(first.width, 0);
  }

  // Modal 宽高不随 section 改变
  const modalBox = await dialog.boundingBox();
  expect(modalBox).not.toBeNull();
  for (const label of ["通用", "学期与课表", "关于"]) {
    await nav.getByRole("button", { name: label }).click();
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeCloseTo(modalBox!.width, 0);
    expect(box!.height).toBeCloseTo(modalBox!.height, 0);
  }

  // Mobile 390：搜索框 + 横向 tabs 仍可用
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav).toBeHidden();
  await expect(page.getByRole("textbox", { name: "搜索设置" })).toBeVisible();
  await page.getByRole("button", { name: "学期与课表" }).click();
  await expect(page.getByTestId("settings-semester")).toBeVisible();
});
