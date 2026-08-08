import { test, expect, Page } from "@playwright/test";

/**
 * MiniCalendar DDL 直接拖动 E2E（Desktop 1440）。
 * 依赖演示数据（相对今天）：英语演讲PPT (Unit 6) = 今天+4天 21:00 截止。
 * 业务结果通过 agenda / feedback / 刷新持久化断言。
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

const DDL_ITEM = (page: Page, title: string) =>
  page.locator(`[data-testid="agenda-ddl-item"]`).filter({ hasText: title });

test("DDL Move：拖英语演讲PPT 到新日期，保留原时间 21:00，刷新后仍在", async ({ page }) => {
  await openOverview(page);
  const source = dPlus(4);
  const target = dPlus(6);

  await selectDate(page, source);
  const item = DDL_ITEM(page, "英语演讲PPT");
  await expect(item).toBeVisible();
  await expect(item).toContainText("DDL 21:00");

  await dragToCell(page, item, target);

  // 反馈：已移动到 M月d日 · 21:00（时间保留）
  const feedback = page.getByTestId("ddl-move-feedback");
  await expect(feedback).toBeVisible();
  await expect(feedback).toContainText(`已移动到 ${monthDayText(target)} · 21:00`);

  // 新日期出现 DDL
  await selectDate(page, target);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toBeVisible();
  await expect(DDL_ITEM(page, "英语演讲PPT")).toContainText("DDL 21:00");

  // 旧日期消失
  await selectDate(page, source);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toHaveCount(0);

  // 刷新后结果仍在
  await page.reload();
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
  await selectDate(page, target);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toBeVisible();
  await expect(DDL_ITEM(page, "英语演讲PPT")).toContainText("DDL 21:00");
});

test("Undo：拖 DDL 后点击撤销，日期恢复原样", async ({ page }) => {
  await openOverview(page);
  const source = dPlus(4);
  const target = dPlus(6);

  await selectDate(page, source);
  await dragToCell(page, DDL_ITEM(page, "英语演讲PPT"), target);
  await expect(page.getByTestId("ddl-move-feedback")).toBeVisible();

  await page.getByTestId("ddl-move-feedback").getByRole("button", { name: "撤销" }).click();

  // 反馈关闭，日期恢复
  await expect(page.getByTestId("ddl-move-feedback")).toHaveCount(0);
  await selectDate(page, source);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toBeVisible();
  await selectDate(page, target);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toHaveCount(0);
});

test("Quick Time Edit：拖到新日期后修改时间 21:00→21:30，保存后刷新仍正确", async ({ page }) => {
  await openOverview(page);
  const source = dPlus(4);
  const target = dPlus(6);

  await selectDate(page, source);
  await dragToCell(page, DDL_ITEM(page, "英语演讲PPT"), target);
  await expect(page.getByTestId("ddl-move-feedback")).toBeVisible();

  await page.getByTestId("ddl-move-feedback").getByRole("button", { name: "修改时间" }).click();
  const popover = page.getByTestId("ddl-move-feedback").locator("input[type='time']");
  await expect(popover).toBeVisible();
  await popover.fill("21:30");
  await page.getByTestId("ddl-move-feedback").getByRole("button", { name: "保存" }).click();

  // 反馈更新时间，agenda 显示新时间
  await expect(page.getByTestId("ddl-move-feedback")).toContainText("· 21:30");
  await selectDate(page, target);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toContainText("DDL 21:30");

  // 刷新后仍然正确
  await page.reload();
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
  await selectDate(page, target);
  await expect(DDL_ITEM(page, "英语演讲PPT")).toContainText("DDL 21:30");
});

test("Mobile 390：DDL 不进入拖动，点击仍打开详情，页面可滚动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();

  // 选择有 DDL 的日期，点击 DDL 项 → Assignment Drawer 打开（无拖动、无反馈）
  await selectDate(page, dPlus(4));
  await DDL_ITEM(page, "英语演讲PPT").click();
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
