import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

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

test("Case D：切换筛选时图表卡与任务卡保持等高（≥460）、无重叠", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const chart = page.getByTestId("study-load-card");
  // ResponsiveContainer 首次测量需要时间，等待高度稳定
  await page.waitForTimeout(700);
  const base = await chart.boundingBox();
  expect(base!.height).toBeGreaterThanOrEqual(460);

  const filters = ["已逾期", "今日截止", "3天内截止", "7天内截止", "已完成归档", "全部"];
  for (const f of filters) {
    await card.getByRole("button", { name: f }).click();
    await page.waitForTimeout(300);
    const chartBox = await chart.boundingBox();
    const cardBox = await card.boundingBox();
    // 2 列等高（grid stretch）；高度可随内容自然增长，但不少于 460
    expect(Math.abs(chartBox!.height - cardBox!.height)).toBeLessThanOrEqual(1);
    expect(cardBox!.height).toBeGreaterThanOrEqual(460);
    // Footer 始终位于最后一行之后（无重叠）
    const footer = page.getByTestId("assignment-footer");
    const lastRow = page.locator('[data-testid="assignment-list"] > div').last();
    if (await lastRow.count()) {
      const fBox = await footer.boundingBox();
      const rBox = await lastRow.boundingBox();
      expect(fBox!.y).toBeGreaterThanOrEqual(rBox!.y + rBox!.height - 1);
    }
  }
});

test("Case 1：空状态真正居中（相对 Header/Footer 之间的内容区）", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const list = page.getByTestId("assignment-list");

  await card.getByRole("button", { name: "已逾期" }).click();
  const empty = page.getByTestId("assignment-empty");
  await expect(empty).toBeVisible();

  // empty state 中心 ≈ 内容区（assignment-list）中心；排除 Header / Footer 的影响
  const listBox = await list.boundingBox();
  const emptyBox = await empty.boundingBox();
  expect(Math.abs(emptyBox!.y + emptyBox!.height / 2 - (listBox!.y + listBox!.height / 2))).toBeLessThanOrEqual(4);
  expect(Math.abs(emptyBox!.x + emptyBox!.width / 2 - (listBox!.x + listBox!.width / 2))).toBeLessThanOrEqual(4);
});

test("Case 2：分页可见时 Footer 位置稳定（三段式，分页居中）", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const footer = page.getByTestId("assignment-footer");
  await expect(footer).toBeVisible();
  await expect(card.getByText("1 / 2", { exact: true })).toBeVisible();

  // 分页器水平居中于卡片（中间列 = 卡片中心）
  const cardBox = await card.boundingBox();
  const pageNum = footer.getByText("1 / 2", { exact: true });
  const numBox = await pageNum.boundingBox();
  expect(
    Math.abs(numBox!.x + numBox!.width / 2 - (cardBox!.x + cardBox!.width / 2))
  ).toBeLessThanOrEqual(4);

  // 左「共 N 项」右「任务工作区」分居两端
  const left = footer.getByText("共 6 项任务", { exact: true });
  const right = footer.getByRole("button", { name: "任务工作区 →" });
  const leftBox = await left.boundingBox();
  const rightBox = await right.boundingBox();
  expect(leftBox!.x - cardBox!.x).toBeLessThan(30); // 贴左
  expect(cardBox!.x + cardBox!.width - (rightBox!.x + rightBox!.width)).toBeLessThan(30); // 贴右
});

test("Case 3：切换筛选时 Footer 始终在最后一行之后、卡片高度可自然增长", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("overview-tasks-wrap");
  const footer = page.getByTestId("assignment-footer");

  const baseCard = await card.boundingBox();
  const baseFooter = await footer.boundingBox();
  // Footer 贴卡片底（卡片 p-4 内边距 ~16px + footer pb-1.5）
  expect(Math.abs(baseCard!.y + baseCard!.height - (baseFooter!.y + baseFooter!.height))).toBeLessThanOrEqual(20);

  for (const f of ["已逾期", "今日截止", "全部"]) {
    await card.getByRole("button", { name: f }).click();
    await page.waitForTimeout(200);
    const cardBox = await card.boundingBox();
    const footerBox = await footer.boundingBox();
    // 卡片高度 ≥460（自然增长，不固定 460）
    expect(cardBox!.height).toBeGreaterThanOrEqual(460);
    // Footer 相对卡片底部距离不变（无重叠 / 无挤压）
    expect(
      Math.abs(
        cardBox!.y + cardBox!.height - (footerBox!.y + footerBox!.height) -
        (baseCard!.y + baseCard!.height - (baseFooter!.y + baseFooter!.height))
      )
    ).toBeLessThanOrEqual(1);
  }
});

test("Case 4：workspace 原有键盘 / selection E2E 继续通过", async ({ page }) => {
  await openOverview(page);
  await page.getByRole("button", { name: "任务工作区" }).click();
  await expect(page.getByRole("heading", { name: "任务工作区" })).toBeVisible();

  const list = page.getByTestId("assignment-list");
  await list.focus();
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await expect(page.getByTestId("assignment-bulk-bar")).toContainText("已选 1 项");
  await page.keyboard.press("j");
  await page.keyboard.press("x");
  await expect(page.getByTestId("assignment-bulk-bar")).toContainText("已选 2 项");
  // 右键 Context Menu 仍在
  await page.locator('[data-assignment-id="a4"]').click({ button: "right" });
  await expect(page.getByTestId("assignment-context-menu")).toBeVisible();
});
