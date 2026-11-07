import { expect } from "@playwright/test";
import { test } from "./demoFixtures";
import type { Page } from "@playwright/test";

async function openPlan(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "时间表", exact: true }).click();
  await page.waitForTimeout(650);
}

async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
}

test.describe("Plan workspace", () => {
  test("1440：Backlog / Canvas 两列，拖入任务后生成学习块并打开 Inspector", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openPlan(page);

    await expect(page.getByTestId("plan-workspace")).toBeVisible();
    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.locator("[data-plan-day]")).toHaveCount(7);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    const firstRow = page.getByTestId("plan-backlog-row").first();
    await firstRow.click();
    const inspector = page.getByTestId("plan-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "打开任务" })).toBeVisible();
    await inspector.getByRole("button", { name: "关闭详情" }).click();
    await expect(inspector).toBeHidden();

    const target = page.locator("[data-plan-day]").nth(2);
    await firstRow.dragTo(target, { targetPosition: { x: 50, y: 180 } });
    await expect(page.getByText(/^已安排 /).first()).toBeVisible();
    await expect(page.getByTestId("plan-inspector").getByText("学习块", { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId("plan-canvas-item").filter({ hasText: "计量经济学大作业" }).first()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByTestId("plan-inspector").getByRole("button", { name: "关闭详情" }).click();
    const studyBlock = page.locator("[data-testid='plan-canvas-item'][data-kind='study']").first();
    await studyBlock.dragTo(page.locator("[data-plan-day]").nth(5), {
      targetPosition: { x: 50, y: 350 },
    });
    await expect(page.getByText(/^已移到 /).first()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("1024：Backlog 收起，按钮打开左侧 Sheet；无横向溢出", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPlan(page);

    await expect(page.getByTestId("plan-backlog")).toHaveCount(0);
    await page.getByRole("button", { name: /待安排 \d+/ }).click();
    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    await expect(page.getByTestId("plan-backlog").getByText("待安排", { exact: true })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test("390：Agenda 取代 7 天网格；待安排 Sheet 可打开并进入安排表单", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPlan(page);

    await expect(page.getByTestId("plan-agenda")).toBeVisible();
    await expect(page.getByTestId("plan-canvas")).toBeHidden();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    await page.getByRole("button", { name: /待安排 \d+/ }).click();
    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    const firstRow = page.getByTestId("plan-backlog-row").first();
    await firstRow.getByRole("button", { name: /安排《/ }).click();
    await expect(page.getByRole("dialog", { name: "安排学习计划" })).toBeVisible();
    await page.getByRole("button", { name: "确认安排" }).click();
    await expect(page.getByText(/^已安排 /).first()).toBeVisible();
    await expect(page.getByTestId("plan-inspector")).toBeVisible();
  });

  test("1920：Backlog / Canvas / Inspector 三列同时存在", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openPlan(page);

    await expect(page.getByTestId("plan-backlog")).toBeVisible();
    await expect(page.getByTestId("plan-canvas")).toBeVisible();
    await expect(page.getByTestId("plan-inspector")).toBeVisible();
    await expect(page.getByText("选择一个任务或时间块")).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
