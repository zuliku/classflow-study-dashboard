import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Layout Hotfix：「任务与 DDL」Workspace 顶部呼吸空间。
 * 横向 gutter 与纵向 top spacing 拆分：
 * mobile: px-16 / pt-20；desktop: px-24 / pt-28。
 * 间距属于 Workspace Chrome → Content（AssignmentsWorkspace body 负责），
 * AssignmentTable / QuickAddCard 自身不加 mt/pt（Overview compact 不受影响）。
 */

async function openAssignments(page: Page) {
  await page.goto("/");
  const width = page.viewportSize()?.width ?? 1440;
  if (width < 768) {
    // 移动端：任务与 DDL 在底部导航（label = 任务）
    await page.getByRole("button", { name: "任务", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  }
  await expect(page.getByTestId("assignment-list")).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(400);
}

async function measure(page: Page) {
  const sticky = await page
    .locator('[data-testid="assignments-tab"] > div.sticky')
    .boundingBox();
  // 首张 Surface = assignment-list 的父级卡片（list 自身 mt-1 属于表内部结构，不参与 Chrome 间距）
  const table = await page.locator('[data-testid="assignment-list"]').locator("xpath=..").boundingBox();
  const quickAdd = page.getByTestId("quick-add-card");
  const quickAddBox = (await quickAdd.count()) ? await quickAdd.boundingBox() : null;
  return { sticky, table, quickAddBox };
}

test("Desktop：ViewBar → 首张 Surface ≈ 28px（QuickAdd 关闭）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAssignments(page);
  const m = await measure(page);
  const gap = m.table!.y - m.sticky!.y - m.sticky!.height;
  expect(Math.abs(gap - 28)).toBeLessThanOrEqual(2);
});

test("Desktop：QuickAdd 打开 → ViewBar → QuickAddCard 同样 ≈ 28px；QuickAdd → Table = 16px", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAssignments(page);
  // 打开 QuickAdd（Header Primary「新增任务」）
  await page.getByRole("button", { name: /新增任务|新增/ }).first().click();
  await expect(page.getByTestId("quick-add-card")).toBeVisible();
  await page.waitForTimeout(300); // Disclosure 180ms 动画 settle 后再测量
  const m = await measure(page);
  const gapToQuick = m.quickAddBox!.y - m.sticky!.y - m.sticky!.height;
  expect(Math.abs(gapToQuick - 28)).toBeLessThanOrEqual(2);
  const quickToTable = m.table!.y - m.quickAddBox!.y - m.quickAddBox!.height;
  expect(Math.abs(quickToTable - 16)).toBeLessThanOrEqual(2);
});

test("Mobile：ViewBar → 首张 Surface ≈ 20px（QuickAdd 关闭）", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAssignments(page);
  const m = await measure(page);
  const gap = m.table!.y - m.sticky!.y - m.sticky!.height;
  expect(Math.abs(gap - 20)).toBeLessThanOrEqual(2);
});

test("QuickAdd 开关不影响顶部间距（同一 28px 基准）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openAssignments(page);
  const closed = await measure(page);
  const gapClosed = closed.table!.y - closed.sticky!.y - closed.sticky!.height;

  await page.getByRole("button", { name: /新增任务|新增/ }).first().click();
  await expect(page.getByTestId("quick-add-card")).toBeVisible();
  await page.waitForTimeout(300); // Disclosure 动画 settle
  const opened = await measure(page);
  const gapOpened = opened.quickAddBox!.y - opened.sticky!.y - opened.sticky!.height;
  expect(Math.abs(gapClosed - gapOpened)).toBeLessThanOrEqual(1);
});
