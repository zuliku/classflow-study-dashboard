import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task Execution Loop V1（focused E2E，依赖 demo 数据）：
 * A. 完整执行循环：开始专注（popover presets）→ 实时控制条（暂停/继续/结束）→
 *    inline follow-up（继续专注/标记完成）→ 执行区累计 → Activity 仅一条「完成专注」
 * B. 其他专注进行中：B 任务 drawer 显示轻量提示 + 查看当前专注（B→A swap，shell 不重挂载）
 * C. 专注期间标记完成：状态 completed 但控制条仍在（可结束）；follow-up 仅保留继续专注
 * D. 自然完成（Playwright Clock：FastFocusRuntime timer）：drawer 观察 active→completed → follow-up + Activity
 * E. completed 任务（无 active 专注）不显示开始专注
 */

async function openAssignmentDrawer(page: import("@playwright/test").Page, title: string) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
  // 默认「聚焦」视图不含全部任务 → 切到「全部」保证目标任务可见
  await page.getByRole("button", { name: "全部" }).first().click();
  await page.getByTestId("assignment-list").getByText(title).click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });
  return drawer;
}

async function startFocus(
  drawer: import("@playwright/test").Locator,
  presetMinutes?: number
) {
  await drawer.getByTestId("focus-start-trigger").click();
  const popover = drawer.getByTestId("focus-start-popover");
  await expect(popover).toBeVisible();
  if (presetMinutes) {
    await popover.getByRole("button", { name: `${presetMinutes} 分` }).click();
  }
  await popover.getByRole("button", { name: "开始专注", exact: true }).click();
  await expect(drawer.getByTestId("assignment-focus-control")).toBeVisible();
}

test("A：完整执行循环（开始→暂停→继续→结束→follow-up→累计→Activity 单条）", async ({ page }) => {
  const drawer = await openAssignmentDrawer(page, "计量经济学大作业（第3章）");

  // 初始：无专注记录；actions 含开始专注（primary slot 独立于 actions 行）
  await expect(drawer.getByTestId("execution-focus-row")).toContainText("尚无专注记录");
  await expect(drawer.getByTestId("focus-start-trigger")).toBeVisible();
  await expect(drawer.getByTestId("detail-primary-actions").getByRole("button", { name: "标记完成" })).toBeVisible();

  await startFocus(drawer, 25);

  // 控制条：running → 暂停
  const control = drawer.getByTestId("assignment-focus-control");
  await expect(control).toContainText(/专注中 · 剩余 2[45]:\d\d/);
  await expect(drawer.getByTestId("execution-focus-row")).toContainText(/专注中 · 剩余/);
  // 开始入口消失（active 时无第二个开始入口）
  await expect(drawer.getByTestId("focus-start-trigger")).toHaveCount(0);

  await control.getByRole("button", { name: "暂停" }).click();
  await expect(control).toContainText(/已暂停 · 剩余/);

  await control.getByRole("button", { name: "继续" }).click();
  await expect(control).toContainText(/专注中 · 剩余/);

  // 结束（manual）→ Toast + follow-up
  await control.getByRole("button", { name: "结束专注" }).click();
  await expect(drawer.getByTestId("focus-follow-up")).toBeVisible();
  await expect(drawer.getByTestId("focus-follow-up")).toContainText(/本次专注完成 · \d+ 分钟/);
  await expect(page.getByText(/已结束专注 · 本次/).first()).toBeVisible();
  // 控制条消失（无 active）→ 回到开始入口
  await expect(drawer.getByTestId("assignment-focus-control")).toHaveCount(0);
  await expect(drawer.getByTestId("focus-start-trigger")).toBeVisible();
  // 累计入执行区
  await expect(drawer.getByTestId("execution-focus-row")).toContainText(/累计 \d+ 分钟 · 1 次/);

  // follow-up：继续专注 → 重新打开 popover；点标题（outside）关闭（follow-up 随之消失；
  // 不用 Escape——drawer 的全局 Escape 也会关闭整个 drawer）
  await drawer.getByTestId("focus-follow-up").getByRole("button", { name: "继续专注" }).click();
  await expect(drawer.getByTestId("focus-start-popover")).toBeVisible();
  await expect(drawer.getByTestId("focus-follow-up")).toHaveCount(0);
  await drawer.getByRole("heading", { name: "计量经济学大作业（第3章）" }).click();
  await expect(drawer.getByTestId("focus-start-popover")).toHaveCount(0);
  await expect(drawer.getByRole("heading", { name: "计量经济学大作业（第3章）" })).toBeVisible();

  // 第二次循环：结束后用 follow-up 标记完成 → 状态完成，follow-up 消失
  await startFocus(drawer, 25);
  const control2 = drawer.getByTestId("assignment-focus-control");
  await control2.getByRole("button", { name: "结束专注" }).click();
  await expect(drawer.getByTestId("focus-follow-up")).toBeVisible();
  await expect(drawer.getByTestId("execution-focus-row")).toContainText(/累计 \d+ 分钟 · 2 次/);
  await drawer.getByTestId("focus-follow-up").getByRole("button", { name: "标记完成" }).click();
  await expect(drawer.getByRole("button", { name: "重新打开" })).toBeVisible();
  await expect(drawer.getByTestId("focus-follow-up")).toHaveCount(0);

  // Activity：恰好两条「完成专注」（focus started/paused 不投影，2 次完成不重复）
  await drawer.getByTestId("entity-activity-trigger-assignment").click();
  await expect(drawer.getByText("完成专注", { exact: true }).first()).toBeVisible({ timeout: 8000 });
  await expect(drawer.getByText("完成专注", { exact: true })).toHaveCount(2);
});

test("B：其他专注进行中 → 查看当前专注（B→A swap，shell 不重挂载）", async ({ page }) => {
  const a1 = await openAssignmentDrawer(page, "计量经济学大作业（第3章）");
  await startFocus(a1, 15);
  await a1.getByRole("button", { name: "关闭" }).click();
  await expect(a1).toHaveCount(0);

  const a2 = await openAssignmentDrawer(page, "市场营销案例汇报");
  await expect(a2.getByTestId("other-focus-status")).toBeVisible();
  await expect(a2.getByTestId("other-focus-status")).toContainText(/其他专注进行中 · 计量经济学大作业/);
  // other 时无开始入口，常规 actions 仍在
  await expect(a2.getByTestId("focus-start-trigger")).toHaveCount(0);
  await expect(a2.getByTestId("detail-primary-actions").getByRole("button", { name: "标记完成" })).toBeVisible();
  // 执行区不显示他人会话的累计
  await expect(a2.getByTestId("execution-focus-row")).toContainText("尚无专注记录");

  await a2.getByTestId("other-focus-status").getByRole("button", { name: "查看当前专注" }).click();
  // B→A：内容替换为 A（标题 + current 控制条）
  await expect(a2.getByRole("heading", { name: "计量经济学大作业（第3章）" })).toBeVisible();
  await expect(a2.getByTestId("assignment-focus-control")).toContainText(/专注中 · 剩余/);
  await expect(a2.getByTestId("other-focus-status")).toHaveCount(0);
});

test("C：专注期间标记完成 → 控制条仍可结束；follow-up 仅保留继续专注", async ({ page }) => {
  const drawer = await openAssignmentDrawer(page, "英语演讲PPT (Unit 6)");
  await startFocus(drawer, 30);

  await drawer.getByTestId("detail-primary-actions").getByRole("button", { name: "标记完成" }).click();
  await expect(drawer.getByRole("button", { name: "重新打开" })).toBeVisible();

  const control = drawer.getByTestId("assignment-focus-control");
  await expect(control).toContainText(/专注中 · 剩余/);
  await control.getByRole("button", { name: "结束专注" }).click();

  const followUp = drawer.getByTestId("focus-follow-up");
  await expect(followUp).toBeVisible();
  await expect(followUp.getByRole("button", { name: "继续专注" })).toBeVisible();
  await expect(followUp.getByRole("button", { name: "标记完成" })).toHaveCount(0);
});

test("D：自然完成（FocusRuntime timer 到期）→ drawer 观察到转换 → follow-up + Activity", async ({ page }) => {
  await page.clock.install();
  const drawer = await openAssignmentDrawer(page, "数据库实验报告（实验四）");
  await expect(drawer.getByTestId("execution-focus-row")).toContainText("尚无专注记录");

  // 自定义 2 分钟
  await drawer.getByTestId("focus-start-trigger").click();
  const popover = drawer.getByTestId("focus-start-popover");
  await expect(popover).toBeVisible();
  await popover.getByLabel("自定义时长（分钟）").fill("2");
  await popover.getByRole("button", { name: "开始专注", exact: true }).click();
  await expect(drawer.getByTestId("assignment-focus-control")).toContainText(/专注中 · 剩余 0[12]:\d\d/);

  // 快进过剩余时长 → FocusRuntime timer 到期 → complete("timer")
  await page.clock.fastForward(130_000);
  await expect(drawer.getByTestId("assignment-focus-control")).toHaveCount(0);
  await expect(page.getByText("专注完成，休息一下吧").first()).toBeVisible({ timeout: 8000 });
  await expect(drawer.getByTestId("focus-follow-up")).toContainText("本次专注完成 · 2 分钟");

  // Activity：真实结算 2 分钟（clamp 到 plannedMs）
  await drawer.getByTestId("entity-activity-trigger-assignment").click();
  await expect(drawer.getByText("完成专注", { exact: true }).first()).toBeVisible({ timeout: 8000 });
  await expect(drawer.getByText("2 分钟", { exact: true }).first()).toBeVisible();
  await expect(drawer.getByText("完成专注", { exact: true })).toHaveCount(1);
});

test("E：completed 任务（无 active 专注）不显示开始专注", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
  // 已完成任务在归档视图（更多视图 → 查看已归档）
  await page.getByRole("button", { name: "更多视图" }).click();
  await page.getByRole("button", { name: "查看已归档" }).click();
  await expect(page.getByTestId("assignment-list")).toBeVisible();
  await page.getByTestId("assignment-list").getByText("高等数学级数与重积分测试").click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toBeVisible({ timeout: 8000 });
  await expect(drawer.getByRole("button", { name: "重新打开" })).toBeVisible();
  await expect(drawer.getByTestId("focus-start-trigger")).toHaveCount(0);
  await expect(drawer.getByTestId("assignment-focus-control")).toHaveCount(0);
  await expect(drawer.getByTestId("execution-focus-row")).toContainText("尚无专注记录");
});
