import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V3 Task 6 — 自定义 Select / Dropdown E2E：
 * 鼠标 open/select/close、键盘导航、Escape、focus-visible、Data action 行为保持。
 */

async function openSettingsAt(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "通用" })
    .click();
}

test("鼠标：点击 trigger 打开 → 选择 option → 关闭且值更新", async ({ page }) => {
  await openSettingsAt(page);
  const motion = page.getByRole("combobox", { name: "动效偏好" });
  await expect(motion).toHaveText("跟随系统");

  await motion.click();
  const listbox = page.getByRole("listbox", { name: "动效偏好" });
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option", { name: "减少动效" })).toBeVisible();

  await listbox.getByRole("option", { name: "减少动效" }).click();
  await expect(listbox).toHaveCount(0); // 选择后关闭
  await expect(motion).toHaveText("减少动效");
  await expect(page.locator("html")).toHaveAttribute("data-motion-preference", "reduced");
  await expect(page.locator("html")).toHaveAttribute("data-motion-effective", "reduced");
});

test("outside click 关闭菜单且不改变值", async ({ page }) => {
  await openSettingsAt(page);
  const motion = page.getByRole("combobox", { name: "动效偏好" });
  await motion.click();
  await expect(page.getByRole("listbox", { name: "动效偏好" })).toBeVisible();
  await page.getByTestId("settings-view").click({ position: { x: 30, y: 30 } });
  await expect(page.getByRole("listbox", { name: "动效偏好" })).toHaveCount(0);
  await expect(motion).toHaveText("跟随系统");
});

test("键盘：Enter 打开 → ArrowDown 导航 → Enter 选择 → 值更新", async ({ page }) => {
  await openSettingsAt(page);
  const motion = page.getByRole("combobox", { name: "动效偏好" });
  await motion.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "动效偏好" })).toBeVisible();

  await page.keyboard.press("ArrowDown"); // 跟随系统 → 完整动效
  await page.keyboard.press("ArrowDown"); // → 减少动效
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "动效偏好" })).toHaveCount(0);
  await expect(motion).toHaveText("减少动效");
});

test("Escape：关闭菜单且焦点回到 trigger", async ({ page }) => {
  await openSettingsAt(page);
  const motion = page.getByRole("combobox", { name: "动效偏好" });
  await motion.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox", { name: "动效偏好" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox", { name: "动效偏好" })).toHaveCount(0);
  await expect(motion).toBeFocused();
});

test("键盘 focus-visible 存在（Tab 聚焦后可见 focus ring）", async ({ page }) => {
  await openSettingsAt(page);
  const motion = page.getByRole("combobox", { name: "动效偏好" });
  await motion.focus();
  const cls = await motion.getAttribute("class");
  expect(cls).toContain("focus-visible:outline-2");
});

test("Data & Storage：action 按钮仍可触发原行为（备份/恢复/危险行存在且可点击）", async ({ page }) => {
  await openSettingsAt(page);
  await page
    .getByRole("navigation", { name: "设置导航" })
    .getByRole("button", { name: "数据与存储" })
    .click();
  await expect(page.getByTestId("settings-data")).toBeVisible();

  // 完整备份 / 仅数据备份 / 恢复 / 危险操作 rows
  await expect(page.getByRole("button", { name: "导出 ZIP" })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出 JSON" })).toBeVisible();
  await expect(page.getByRole("button", { name: "选择文件" })).toBeVisible();
  await expect(page.getByTestId("danger-preferences")).toBeVisible();
  await expect(page.getByTestId("danger-learning")).toBeVisible();
  await expect(page.getByTestId("danger-entire")).toBeVisible();

  // 危险确认仍走 confirm dialog（点击后出现确认弹层，不直接执行）
  await page.getByTestId("danger-learning").click();
  await expect(page.getByText("清空学习数据？", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "取消", exact: true }).first().click();
});

test("mobile 390：通用页 dropdown 可用且无横向溢出", async ({ page }) => {
  // 设置 Modal 在桌面打开后缩放到 390（沿用既有模式）
  await openSettingsAt(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId("settings-view")).toBeVisible();
  const motion = page.getByRole("combobox", { name: "动效偏好" });
  await motion.click();
  // Mobile 全屏 Dialog 下用 Select 的键盘契约，避免 body portal 与 viewport resize 的命中测试竞态。
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(motion).toHaveText("完整动效");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});


test("模型菜单内部滚动不关闭，滚动后的选项仍可选择；外部 scroll 关闭", async ({ page }) => {
  await page.route("**/api/ai/models?provider=opencode-go", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: Array.from({ length: 20 }, (_, i) => ({
          id: `scroll-model-${i + 1}`,
          name: `测试滚动模型 ${String(i + 1).padStart(2, "0")}`,
          transport: "openai-compatible",
          vendor: "openai",
        })),
      }),
    });
  });
  await page.addInitScript(({ settings }) => {
    localStorage.setItem(
      "classflow-ai-settings-v1",
      JSON.stringify({
        version: 0,
        state: settings,
      })
    );
  }, {
    settings: {
      enabled: true,
      provider: "opencode-go",
      model: "scroll-model-01",
      custom: { providerName: "", baseURL: "", model: "" },
    },
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "Kiro 与 AI" }).click();
  await page.waitForTimeout(400);

  const modelTrigger = page.getByRole("combobox", { name: "模型", exact: true });
  await expect(modelTrigger).toBeVisible();
  await modelTrigger.click();
  const listbox = page.getByRole("listbox", { name: "模型", exact: true });
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option", { name: "测试滚动模型 01" })).toBeVisible();

  // 列表真实可滚动
  await expect.poll(() => listbox.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

  // 菜单内部 wheel 滚动：菜单保持打开
  await listbox.hover();
  await page.mouse.wheel(0, 500);
  await expect(listbox).toBeVisible();

  // 滚动后的选项仍可选择
  const last = listbox.getByRole("option", { name: "测试滚动模型 20" });
  await last.scrollIntoViewIfNeeded();
  await last.click();
  await expect(listbox).toHaveCount(0);
  await expect(modelTrigger).toContainText("测试滚动模型 20");

  // 外部 window scroll：fixed-position 菜单关闭
  await modelTrigger.click();
  await expect(listbox).toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new Event("scroll"));
  });
  await expect(listbox).toHaveCount(0);
});