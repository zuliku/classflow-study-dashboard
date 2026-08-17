import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * MiniCalendar 共享 Selection Indicator E2E：
 * 不依赖截图，仅验证 indicator 唯一性、选中更新、位置移动与月份切换重新锚定。
 */

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function dPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmt(d);
}

async function openOverview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("calendar-selection-indicator")).toHaveCount(1);
}

test("Calendar：indicator 唯一，点击日期后移动到新位置且 agenda 对应", async ({ page }) => {
  await openOverview(page);

  const indicator = page.getByTestId("calendar-selection-indicator");
  const today = dPlus(0);
  const target = dPlus(3);

  // 初始：今天被选中（indicator 覆盖今天格子），仅 1 个 indicator
  await expect(indicator).toBeVisible();
  await expect(page.locator("[data-selected-date]")).toHaveAttribute("data-selected-date", today);
  const before = await indicator.boundingBox();
  expect(before!.width).toBeGreaterThan(0);

  // 点击 3 天后：indicator 位置移动
  await page.locator(`[data-calendar-day="${target}"]`).click();
  await expect(indicator).toHaveCount(1);
  await expect(page.locator("[data-selected-date]")).toHaveAttribute("data-selected-date", target);
  await page.waitForTimeout(300); // 等 180ms 过渡结束
  const after = await indicator.boundingBox();
  expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(0);

  // agenda 内容对应目标日期
  const [, m, d] = target.split("-").map(Number);
  await expect(
    page.locator("main").getByText(new RegExp(`${m}月${d}日.*当日日程`)).first()
  ).toBeVisible();
});

test("Calendar：月份切换后 indicator 重新锚定（不做跨月滑动），点击新月份日期仍唯一", async ({ page }) => {
  await openOverview(page);

  const indicator = page.getByTestId("calendar-selection-indicator");
  const before = await indicator.boundingBox();
  expect(before).not.toBeNull();

  // 切到下一月：indicator 仍唯一；若原日期不在新月份，indicator 隐藏（opacity 0 或宽度 0）
  await page.getByRole("button", { name: "下一月" }).click();
  await expect(indicator).toHaveCount(1);
  await page.waitForTimeout(300);

  // 点击新月份中可见的某一天（取当前渲染网格的最后一个日期格）
  const cells = page.locator("[data-calendar-day]");
  const count = await cells.count();
  const lastDate = await cells.nth(count - 1).getAttribute("data-calendar-day");
  await cells.nth(count - 1).click();
  await expect(indicator).toHaveCount(1);
  await expect(page.locator("[data-selected-date]")).toHaveAttribute(
    "data-selected-date",
    lastDate!
  );
  await page.waitForTimeout(300);
  const after = await indicator.boundingBox();
  // 选中态可见且尺寸非零（已锚定到新日期）
  expect(after!.width).toBeGreaterThan(0);
  expect(after!.height).toBeGreaterThan(0);

  // agenda 标题月份与所选日期一致
  const [, m, d] = lastDate!.split("-").map(Number);
  await expect(
    page.locator("main").getByText(new RegExp(`${m}月${d}日.*当日日程`)).first()
  ).toBeVisible();
});
