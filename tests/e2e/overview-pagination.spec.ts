import { test, expect, Page } from "@playwright/test";

/**
 * Overview 双栏（课程负荷 + 任务清单分页）E2E。
 * 演示数据 6 条任务（全部）→ compact 分页 5/页 → 第 1 / 2 页。
 * 分页 footer 位于 AssignmentTable 根卡片内（assignment-list 容器的兄弟节点），
 * 因此以 overview-tasks-wrap 作为 scope。
 */

const ROW = (id: string) => `[data-assignment-id="${id}"]`;

async function openOverview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("study-load-card")).toBeVisible();
  await expect(page.getByTestId("assignment-list")).toBeVisible();
}

test("Case A：全部任务 > 5 → 首屏 5 条，第 1 / 2 页，下一页显示剩余", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const list = page.getByTestId("assignment-list");

  // 首屏 5 条（演示数据共 6 条）
  await expect(list.locator('[data-assignment-id]')).toHaveCount(5);
  await expect(card.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(card.getByText("共 6 项任务", { exact: true })).toBeVisible();

  // 上一页 disabled（第 1 页）
  await expect(card.getByRole("button", { name: "上一页" })).toBeDisabled();

  // 下一页 → 剩余 1 条
  await card.getByRole("button", { name: "下一页" }).click();
  await expect(list.locator('[data-assignment-id]')).toHaveCount(1);
  await expect(card.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "下一页" })).toBeDisabled();
});

test("Case B：第 2 页切换筛选 → 自动回第 1 页", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");

  await card.getByRole("button", { name: "下一页" }).click();
  await expect(card.getByText("2 / 2", { exact: true })).toBeVisible();

  // 切「今日截止」：今日无 DDL（演示数据均在未来）→ 0 条 → 回第 1 页
  await card.getByRole("button", { name: "今日截止" }).click();
  await expect(card.getByText("共 0 项任务", { exact: true })).toBeVisible();
  // 单页时不显示分页控件（只有一页无需页码）
  await expect(card.getByRole("button", { name: "上一页" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "下一页" })).toHaveCount(0);
});

test("Case C：删除导致总页数减少 → 当前页自动 clamp（不出现 第 2 / 1 页）", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const list = page.getByTestId("assignment-list");

  // 到第 2 页（1 条任务），删除它 → 只剩 5 条 → 回第 1 / 1 页
  await card.getByRole("button", { name: "下一页" }).click();
  await expect(card.getByText("2 / 2", { exact: true })).toBeVisible();

  const row = page.locator(ROW("a6"));
  await row.hover();
  await row.getByTitle("删除任务").click();
  // 批量删除动作带 ConfirmDialog（确认按钮在 DOM 末尾，.last() 避免命中行的删除按钮）
  await expect(page.getByRole("button", { name: "删除任务" }).last()).toBeVisible();
  await page.getByRole("button", { name: "删除任务" }).last().click();
  await expect(page.getByText("任务已删除").first()).toBeVisible();

  // 自动 clamp：不再显示 2 / 2，且单页时不显示分页控件
  await expect(card.getByText("2 / 2", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "下一页" })).toHaveCount(0);
  await expect(list.locator('[data-assignment-id]')).toHaveCount(5);

  // 撤销恢复：数据回到 6 条，原第 2 页重新有效（clamp 只防越界，不强制回 1）
  await page.getByRole("button", { name: "撤销" }).click();
  await expect(card.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(list.locator('[data-assignment-id]')).toHaveCount(1);
});

test("Case D：切换全部 6 个筛选，StudyLoadChart 外层卡片高度保持不变", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const chart = page.getByTestId("study-load-card");
  // ResponsiveContainer 首次测量需要时间，等待高度稳定为固定 Dashboard 高度
  await page.waitForTimeout(700);
  const base = await chart.boundingBox();
  expect(base!.height).toBeGreaterThan(300);

  const filters = ["已逾期", "今日截止", "3天内截止", "7天内截止", "已完成归档", "全部"];
  for (const f of filters) {
    await card.getByRole("button", { name: f }).click();
    await page.waitForTimeout(300);
    const box = await chart.boundingBox();
    expect(Math.abs(box!.height - base!.height)).toBeLessThanOrEqual(1);
  }

  // 左右两张卡片顶部对齐且高度一致（desktop，均固定 460px）
  const right = await page.getByTestId("overview-tasks-wrap").boundingBox();
  expect(Math.abs(right!.height - base!.height)).toBeLessThanOrEqual(1);
  expect(right!.height).toBeCloseTo(460, 0);
});

test("Case E：进入 assignments workspace，J/K / Space / X / Enter 仍正常（未被 compact 分页截断）", async ({ page }) => {
  await openOverview(page);
  await page.getByRole("button", { name: "任务工作区" }).click();
  await expect(page.getByRole("heading", { name: "任务工作区" })).toBeVisible();

  const list = page.getByTestId("assignment-list");
  await list.focus();
  await page.keyboard.press("j"); // highlight a1
  await page.keyboard.press("x"); // 选 a1

  const bar = page.getByTestId("assignment-bulk-bar");
  await expect(bar).toBeVisible();
  await expect(bar).toContainText("已选 1 项");

  // Space Peek
  await page.keyboard.press("Space");
  await expect(page.getByTestId("assignment-peek")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("assignment-peek")).toHaveCount(0);

  // Enter 打开 Drawer（a1）
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "计量经济学大作业（第3章）" }).last()).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();
});
