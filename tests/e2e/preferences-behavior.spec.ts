import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Preferences 真实业务接入 E2E：设置修改必须产生可见行为变化。
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

async function gotoInteraction(page: Page) {
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "交互与快捷键" }).click();
}

async function gotoGeneral(page: Page) {
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "通用" }).click();
}

async function gotoOverview(page: Page) {
  // 设置是 Modal：先关闭（Esc），再回到总览
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await page.getByRole("button", { name: "总览" }).first().click();
  await expect(page.getByTestId("timetable-card")).toBeVisible();
}

async function gotoWorkspaceTab(page: Page, name: string) {
  // 设置是 Modal：先关闭（Esc），再切换到工作区 Tab
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  await page.getByRole("button", { name }).first().click();
}

test("showWeekends：关闭 → 课表 5 列（周六/周日表头消失）→ 打开恢复", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "学期与课表" }).click();
  await page.getByRole("switch", { name: "显示周末" }).click(); // off
  await expect(page.getByRole("switch", { name: "显示周末" })).toHaveAttribute("aria-checked", "false");

  await gotoOverview(page);
  await expect(page.getByTestId("timetable-card").getByText("周六", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("timetable-card").getByText("周日", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("timetable-card").getByText("周五", { exact: true })).toBeVisible();

  // 打开恢复 7 列
  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "学期与课表" }).click();
  await page.getByRole("switch", { name: "显示周末" }).click(); // on
  await expect(page.getByRole("switch", { name: "显示周末" })).toHaveAttribute("aria-checked", "true");
  await gotoOverview(page);
  await expect(page.getByTestId("timetable-card").getByText("周六", { exact: true })).toBeVisible();
  await expect(page.getByTestId("timetable-card").getByText("周日", { exact: true })).toBeVisible();
});

test("schedule manipulation：关闭 → 拖动不发生、点击正常；打开 → 拖动恢复", async ({ page }) => {
  await openSettings(page);
  await gotoInteraction(page);
  await page.getByRole("switch", { name: "课表直接操作" }).click(); // off
  await expect(page.getByRole("switch", { name: "课表直接操作" })).toHaveAttribute("aria-checked", "false");

  // 关闭：拖高数课程 → 无提交 toast，位置不变
  await gotoWorkspaceTab(page, "时间表");
  await expect(page.getByTestId("timetable-body")).toBeVisible();
  const body = await page.getByTestId("timetable-body").boundingBox();
  const card = page.locator('[data-testid="schedule-card"]').filter({ hasText: "高等数学" }).first();
  const from = await card.boundingBox();
  const to = { x: body!.x + (4.5 / 7) * body!.width, y: body!.y + ((12 * 60 - 8 * 60) / 780) * body!.height };
  await page.mouse.move(from!.x + from!.width / 2, from!.y + 3);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.getByText("课程时间已调整")).toHaveCount(0);
  // 点击课程仍打开 Drawer
  await page.locator('[data-testid="schedule-card"]').filter({ hasText: "高等数学" }).first().click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();

  // 打开：拖动恢复
  await openSettings(page);
  await gotoInteraction(page);
  await page.getByRole("switch", { name: "课表直接操作" }).click(); // on
  await gotoWorkspaceTab(page, "时间表");
  await expect(page.getByTestId("timetable-body")).toBeVisible();
  const body2 = await page.getByTestId("timetable-body").boundingBox();
  const card2 = page.locator('[data-testid="schedule-card"]').filter({ hasText: "高等数学" }).first();
  const from2 = await card2.boundingBox();
  const to2 = { x: body2!.x + (4.5 / 7) * body2!.width, y: body2!.y + ((12 * 60 - 8 * 60) / 780) * body2!.height };
  await page.mouse.move(from2!.x + from2!.width / 2, from2!.y + 3);
  await page.mouse.down();
  await page.mouse.move(to2.x, to2.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("课程时间已调整").first()).toBeVisible();
});

test("DDL drag：关闭 → 拖动不发生、点击正常；打开 → 拖动恢复", async ({ page }) => {
  await openSettings(page);
  await gotoInteraction(page);
  await page.getByRole("switch", { name: "DDL 直接操作" }).click(); // off

  await gotoOverview(page);
  // 关闭：拖 DDL cell → 无 feedback；点击 → Assignment Drawer
  const src = new Date();
  src.setDate(src.getDate() + 4);
  const srcStr = `${src.getFullYear()}-${String(src.getMonth() + 1).padStart(2, "0")}-${String(src.getDate()).padStart(2, "0")}`;
  const tgt = new Date();
  tgt.setDate(tgt.getDate() + 6);
  const tgtStr = `${tgt.getFullYear()}-${String(tgt.getMonth() + 1).padStart(2, "0")}-${String(tgt.getDate()).padStart(2, "0")}`;
  await page.locator(`[data-calendar-day="${srcStr}"]`).click();
  const cell = page.locator('[data-testid="agenda-ddl-item"][data-agenda-assignment="a3"]');
  await expect(cell).toBeVisible();
  const targetCell = page.locator(`[data-calendar-day="${tgtStr}"]`);
  const from = await cell.boundingBox();
  const to = await targetCell.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await expect(page.getByTestId("ddl-move-feedback")).toHaveCount(0);
  // 点击仍打开 Drawer
  await cell.click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();

  // 打开：拖动恢复
  await openSettings(page);
  await gotoInteraction(page);
  await page.getByRole("switch", { name: "DDL 直接操作" }).click(); // on
  await gotoOverview(page);
  await page.locator(`[data-calendar-day="${srcStr}"]`).click();
  const cell2 = page.locator('[data-testid="agenda-ddl-item"][data-agenda-assignment="a3"]');
  const from2 = await cell2.boundingBox();
  const to2 = await targetCell.boundingBox();
  await page.mouse.move(from2!.x + from2!.width / 2, from2!.y + from2!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to2!.x + to2!.width / 2, to2!.y + to2!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId("ddl-move-feedback")).toBeVisible();
});

test("ddlWarningDays：1 天 → 临近 DDL 只显示 1 条；7 天 → 5 条", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "任务" }).click();

  await page.getByRole("button", { name: "1 天", exact: true }).click();
  await expect(page.getByRole("button", { name: "1 天", exact: true })).toHaveAttribute("aria-pressed", "true");

  await gotoOverview(page);
  // differenceInDays 为「经过整天数」：1 天窗口内仅「明天 23:59」这一条（2 天后 18:00 diff=2）
  await expect(page.getByTestId("upcoming-ddl-card").getByText("1 项待办")).toBeVisible();

  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "任务" }).click();
  await page.getByRole("button", { name: "7 天", exact: true }).click();
  await gotoOverview(page);
  await expect(page.getByTestId("upcoming-ddl-card").getByText("5 项待办")).toBeVisible();
});

test("defaultDDLTime：改为 21:00 → 新建任务默认截止时间 21:00（编辑已有任务不受影响）", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "任务" }).click();
  const timeInput = page.getByTestId("settings-tasks").locator("input[type='time']");
  await timeInput.fill("21:00");
  await expect(timeInput).toHaveValue("21:00");

  // 新建任务（N）→ 启用截止时间 → 弹窗默认 21:00（Task V2：未启用 = 无截止日期）
  await gotoOverview(page);
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await page.getByLabel("设置截止时间").check();
  const modalTime = page.locator("input[type='time']").last();
  await expect(modalTime).toHaveValue("21:00");
  await page.keyboard.press("Escape");

  // 编辑已有任务 → 回填原 DDL 时间（不受偏好影响）
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await page.locator('[data-assignment-id="a1"]').click();
  await page.getByTitle("编辑任务").last().click();
  const editTime = page.locator("input[type='time']").last();
  await expect(editTime).toHaveValue("23:59"); // a1 原 DDL 23:59
});

test("motionPreference：reduced → effective motion 生效且导航功能正常", async ({ page }) => {
  await openSettings(page);
  // Settings V3 IA：动效偏好归入通用页；自定义 dropdown（combobox + option）
  await gotoGeneral(page);
  await page.getByRole("combobox", { name: "动效偏好" }).click();
  await page.getByRole("option", { name: "减少动效" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion-preference", "reduced");
  await expect(page.locator("html")).toHaveAttribute("data-motion-effective", "reduced");

  // 功能正常：切换 Tab + 命令中心
  await gotoOverview(page);
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await expect(page.getByRole("heading", { name: "课程资料" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-center")).toBeVisible();
  await page.keyboard.press("Escape");
});
