import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Settings V4 — Responsive Settings E2E：
 * desktop 1440 / tablet 768 / mobile 390 下验证统一 primitives 布局。
 * 不允许：横向溢出、control 被压扁、label 与 control 重叠。
 * V4 IA：交互偏好已并入「通用」页（启动 / 界面 / 操作与快捷键 三组）。
 */

async function openSettingsAt(page: Page, width: number, height: number) {
  // 设置 Modal 在桌面打开，再缩放到目标视口（沿用 settings.spec 的移动端模式）
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page.setViewportSize({ width, height });
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

/** 设置左侧导航（排除通用页「常用入口」同名按钮） */
async function navTo(page: Page, name: string) {
  await page.getByTestId("settings-view").getByRole("button", { name, exact: true }).click();
}

async function noHorizontalOverflow(dialog: ReturnType<Page["getByTestId"]>) {
  const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("desktop 1440：通用页（启动/界面/操作与快捷键）rows 完整显示且无横向溢出", async ({ page }) => {
  await openSettingsAt(page, 1440, 900);
  await navTo(page, "通用");
  await expect(page.getByTestId("settings-general")).toBeVisible();

  const dialog = page.getByRole("dialog");
  await noHorizontalOverflow(dialog);

  // 操作与快捷键组：3 个 toggle 都在可视区域内且可见
  for (const label of ["课表直接操作", "DDL 直接操作", "启用单键快捷键"]) {
    await expect(page.getByRole("switch", { name: label })).toBeVisible();
  }

  // 界面组：界面密度 / 动效偏好
  await expect(page.getByRole("group", { name: "界面密度" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "动效偏好" })).toBeVisible();
});

test("tablet 768：分组容器不溢出，控件可交互", async ({ page }) => {
  await openSettingsAt(page, 768, 1024);
  await navTo(page, "通用");
  await expect(page.getByTestId("settings-general")).toBeVisible();

  const dialog = page.getByRole("dialog");
  await noHorizontalOverflow(dialog);

  const toggle = page.getByRole("switch", { name: "课表直接操作" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
});

test("mobile 390：rows 无重叠、控件不压扁、无横向溢出", async ({ page }) => {
  await openSettingsAt(page, 390, 844);
  await navTo(page, "通用");
  await expect(page.getByTestId("settings-general")).toBeVisible();

  const dialog = page.getByRole("dialog");
  await noHorizontalOverflow(dialog);

  // label 与 control 不重叠：文本块与开关边界盒不交叉
  const row = page.getByTestId("settings-general").getByRole("switch", { name: "启用单键快捷键" });
  const label = page.getByTestId("settings-general").getByText("启用单键快捷键", { exact: true });
  const ctrlBox = await row.boundingBox();
  const labelBox = await label.boundingBox();
  expect(ctrlBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(ctrlBox!.x).toBeGreaterThanOrEqual(labelBox!.x + labelBox!.width - 1); // control 在 label 右侧，不重叠

  // 分段控件完整可见（不溢出 dialog 右缘）
  const segmented = page.getByRole("group", { name: "界面密度" });
  await expect(segmented).toBeVisible();
  const segBox = await segmented.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(segBox).not.toBeNull();
  expect(dialogBox).not.toBeNull();
  expect(segBox!.x + segBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);
});

test("mobile 390：通用页启动位置分段控件可用且无溢出", async ({ page }) => {
  await openSettingsAt(page, 390, 844);
  const dialog = page.getByRole("dialog");
  await noHorizontalOverflow(dialog);

  const group = page.getByRole("group", { name: "默认打开位置" });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "课表" }).click();
  await expect(group.getByRole("button", { name: "课表" })).toHaveAttribute("aria-pressed", "true");
});
