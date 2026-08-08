import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * MiniCalendar DDL 直接拖动 E2E（Desktop 1440）。
 * 依赖演示数据（相对今天）：a3 英语演讲PPT (Unit 6) = 今天+4天 21:00 截止。
 * Agenda 为横向 Compact Event Grid：DDL cell 用 data-agenda-assignment 定位（cell 不显示标题/时间）。
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

/** M月d日 显示文本（与 MiniCalendar format 一致，zhCN 不带前导零） */
function monthDayText(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

async function openOverview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
}

async function selectDate(page: Page, dateStr: string) {
  const cell = page.locator(`[data-calendar-day="${dateStr}"]`);
  await expect(cell).toBeVisible();
  await cell.click();
}

/** DDL cell：按 assignment id 定位 */
function DDL_CELL(page: Page, assignmentId: string) {
  return page.locator(
    `[data-testid="agenda-ddl-item"][data-agenda-assignment="${assignmentId}"]`
  );
}

async function dragToCell(
  page: Page,
  fromLocator: ReturnType<Page["locator"]>,
  targetDateStr: string
) {
  const cell = page.locator(`[data-calendar-day="${targetDateStr}"]`);
  await expect(cell).toBeVisible();
  // boundingBox 不触发滚动：先把源项与目标格都滚入视口
  await fromLocator.scrollIntoViewIfNeeded();
  await cell.scrollIntoViewIfNeeded();
  await expect(fromLocator).toBeVisible();
  const from = await fromLocator.boundingBox();
  const to = await cell.boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("DDL Move：拖 a3 到新日期，保留原时间 21:00，刷新后仍在", async ({ page }) => {
  await openOverview(page);
  const source = dPlus(4);
  const target = dPlus(6);

  await selectDate(page, source);
  const item = DDL_CELL(page, "a3");
  await expect(item).toBeVisible();
  await expect(item).toContainText("DDL"); // cell 只显示类型

  await dragToCell(page, item, target);

  // 反馈：已移动到 M月d日 · 21:00（时间保留）
  const feedback = page.getByTestId("ddl-move-feedback");
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText(`已移动到 ${monthDayText(target)} · 21:00`);

  // 新日期出现该 DDL cell
  await selectDate(page, target);
  await expect(DDL_CELL(page, "a3")).toBeVisible();

  // 旧日期消失
  await selectDate(page, source);
  await expect(DDL_CELL(page, "a3")).toHaveCount(0);

  // 刷新后结果仍在
  await page.reload();
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
  await selectDate(page, target);
  await expect(DDL_CELL(page, "a3")).toBeVisible();
});

test("Undo：拖 DDL 后点击撤销，日期恢复原样", async ({ page }) => {
  await openOverview(page);
  const source = dPlus(4);
  const target = dPlus(6);

  await selectDate(page, source);
  await dragToCell(page, DDL_CELL(page, "a3"), target);
  await expect(page.getByTestId("ddl-move-feedback")).toBeVisible();

  await page.getByTestId("ddl-move-feedback").getByRole("button", { name: "撤销" }).click();

  // 反馈关闭，日期恢复
  await expect(page.getByTestId("ddl-move-feedback")).toHaveCount(0);
  await selectDate(page, source);
  await expect(DDL_CELL(page, "a3")).toBeVisible();
  await selectDate(page, target);
  await expect(DDL_CELL(page, "a3")).toHaveCount(0);
});

test("Quick Time Edit：拖到新日期后修改时间 21:00→21:30，保存后刷新仍正确", async ({ page }) => {
  await openOverview(page);
  const source = dPlus(4);
  const target = dPlus(6);

  await selectDate(page, source);
  await dragToCell(page, DDL_CELL(page, "a3"), target);
  await expect(page.getByTestId("ddl-move-feedback")).toBeVisible();

  await page.getByTestId("ddl-move-feedback").getByRole("button", { name: "修改时间" }).click();
  const popover = page.getByTestId("ddl-move-feedback").locator("input[type='time']");
  await expect(popover).toBeVisible();
  await popover.fill("21:30");
  await page.getByTestId("ddl-move-feedback").getByRole("button", { name: "保存" }).click();

  // 反馈更新时间
  await expect(page.getByTestId("ddl-move-feedback")).toContainText("· 21:30");
  await selectDate(page, target);
  await expect(DDL_CELL(page, "a3")).toBeVisible();

  // 刷新后仍然正确（cell 仍在目标日期）
  await page.reload();
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
  await selectDate(page, target);
  await expect(DDL_CELL(page, "a3")).toBeVisible();
});

test("Mobile 390：DDL cell 不进入拖动，点击仍打开详情，页面可滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();

  // 选择有 DDL 的日期，点击 DDL cell → Assignment Drawer 打开（无拖动、无反馈）
  await selectDate(page, dPlus(4));
  await DDL_CELL(page, "a3").click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
  await expect(page.getByTestId("ddl-move-feedback")).toHaveCount(0);
  await expect(page.getByText("已移动到")).toHaveCount(0);

  // 关闭抽屉后页面可正常滚动（页面滚动容器为 document）
  await page.getByRole("button", { name: "关闭" }).first().click();
  const scrollable = await page.evaluate(() => {
    window.scrollTo(0, 99999);
    return window.scrollY;
  });
  expect(scrollable).toBeGreaterThan(0);
});
