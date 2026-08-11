import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V3 Task 4 — Reminder / Focus / Kiro Settings Productization E2E：
 * - Reminder：应用内提醒（静态真实状态）+ 浏览器通知权限状态真实反映（granted/denied/default，不伪造）
 * - Focus：专注与学习 section 存在且展示真实行为说明（无伪造开关）
 * - Kiro：模型/回答/记忆/隐私分组结构；输出字号与记忆开关仍可用（同 store）
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

test("任务与提醒：应用内提醒始终开启，浏览器通知权限状态真实反映", async ({ page }) => {
  // 授权通知权限（浏览器侧真实权限）：开关才能实际生效
  await page.context().grantPermissions(["notifications"]);
  await openSettings(page);
  await page.getByTestId("settings-view").getByRole("button", { name: "任务与提醒", exact: true }).click();

  // 应用内提醒：静态真实状态（无伪造开关）
  await expect(page.getByTestId("settings-tasks").getByText("应用内提醒", { exact: true })).toBeVisible();
  await expect(page.getByTestId("settings-tasks").getByText("始终开启", { exact: true })).toBeVisible();

  // 浏览器通知权限：状态行反映真实浏览器状态（granted 后显示「已授权」）
  const permissionState = page.getByTestId("notification-permission-state");
  await expect(permissionState).toBeVisible();
  const text = (await permissionState.textContent()) ?? "";
  expect(text.length).toBeGreaterThan(0);
  const realStates = ["已授权", "已阻止", "未授权", "不支持"];
  expect(realStates.some((s) => text.includes(s)), text).toBe(true);

  // 开关与真实权限状态一致：已授权才可切换；未授权时保持关闭（真实权限门控，不伪造已开启）
  const toggle = page.getByRole("switch", { name: "浏览器系统通知" });
  if (text.includes("已授权")) {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  } else {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  }
});

test("专注与学习：section 展示真实行为说明，无伪造开关", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("settings-view").getByRole("button", { name: "专注与学习", exact: true }).click();
  await expect(page.getByTestId("settings-focus")).toBeVisible();
  await expect(page.getByTestId("settings-focus").getByText("实时专注计时", { exact: true })).toBeVisible();
  await expect(page.getByTestId("settings-focus").getByText("已启用", { exact: true })).toBeVisible();
  // 无伪造开关：专注页不应出现 switch
  await expect(page.getByTestId("settings-focus").getByRole("switch")).toHaveCount(0);
});

test("Kiro 与 AI：模型/回答/记忆/隐私分组齐全，输出字号与记忆开关仍可用", async ({ page }) => {
  await openSettings(page);
  await page.getByTestId("settings-view").getByRole("button", { name: "Kiro 与 AI", exact: true }).click();
  const kiro = page.getByTestId("settings-kiro");
  await expect(kiro).toBeVisible();

  // 分组结构：唯一文本的组标题（「模型」与 row 标题撞名，改用组内 row 验证）
  await expect(kiro.getByText("回答", { exact: true })).toBeVisible();
  await expect(kiro.getByText("记忆", { exact: true })).toBeVisible();
  await expect(kiro.getByText("隐私", { exact: true })).toBeVisible();
  // 模型组：AI 服务 / API Key / 连接状态 rows 均存在
  await expect(kiro.locator('[data-setting-id="ai-provider"]')).toBeVisible();
  await expect(kiro.locator('[data-setting-id="ai-api-key"]')).toBeVisible();
  await expect(kiro.locator('[data-setting-id="ai-connection-status"]')).toBeVisible();

  // 输出字号 segmented（同一 useKiroPreferencesStore，Rail 菜单同步）
  const textSize = kiro.getByRole("group", { name: "Kiro 输出字号" });
  await expect(textSize).toBeVisible();
  await textSize.getByRole("button", { name: "大" }).click();
  await expect(textSize.getByRole("button", { name: "大" })).toHaveAttribute("aria-pressed", "true");

  // 记忆开关（role=switch aria-label 保留，kiro-memory.spec 依赖）
  const memoryToggle = kiro.getByRole("switch", { name: "启用 Kiro 记忆" });
  await expect(memoryToggle).toBeVisible();
  await memoryToggle.click();
  await expect(memoryToggle).toHaveAttribute("aria-checked", "false");
  await memoryToggle.click();
  await expect(memoryToggle).toHaveAttribute("aria-checked", "true");

  // 连接状态：测试连接按钮存在
  await expect(kiro.getByRole("button", { name: "测试连接" })).toBeVisible();
});
