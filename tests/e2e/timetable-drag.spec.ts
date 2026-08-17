import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * 直接编辑课表 E2E（Desktop 1280）：Move / Undo / Conflict / Resize。
 * 依赖全新存储中的演示课表（如 material-undo 的既有约定）：
 *   周一 10:00–11:40 高等数学、周一 08:00–09:40 微观经济学、周三 10:00–11:40 高等数学
 * 业务结果一律通过元素位置/Store 持久化断言，不做截图对比。
 */

const BODY_TOP_MINUTES = 8 * 60;
const BODY_TOTAL_MINUTES = 780; // 08:00–21:00

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByText(/第 \d+ 周/).first()).toBeVisible();
  await expect(page.getByTestId("timetable-body")).toBeVisible();
}

async function bodyBox(page: Page) {
  return page.getByTestId("timetable-body").boundingBox();
}

/** 每张「高等数学」课程卡所在的星期列索引（0=周一） */
async function gaoshuDays(page: Page): Promise<number[]> {
  const body = await bodyBox(page);
  const cards = page.locator('[data-testid="schedule-card"]').filter({ hasText: "高等数学" });
  const days: number[] = [];
  for (let i = 0; i < await cards.count(); i++) {
    const box = await cards.nth(i).boundingBox();
    if (box && body) days.push(Math.floor(((box.x + box.width / 2) - body.x) / body.width * 7));
  }
  return days.sort((a, b) => a - b);
}

/** 目标坐标：星期 dayIdx（0–6）+ 时间 minutes（08:00 起） */
function targetPoint(body: { x: number; y: number; width: number; height: number }, dayIdx: number, minutes: number) {
  return {
    x: body.x + ((dayIdx + 0.5) / 7) * body.width,
    y: body.y + ((minutes - BODY_TOP_MINUTES) / BODY_TOTAL_MINUTES) * body.height,
  };
}

async function dragMouse(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** 课程卡 height/top 有 190ms 过渡动画，提交后等待布局稳定再测量 */
async function settle(page: Page) {
  await page.waitForTimeout(400);
}

test("Move：拖高等数学 周一→周五 12:00，时间更新，刷新后仍在", async ({ page }) => {
  await openWorkspace(page);

  // 初始：高等数学 在 周一 + 周三
  expect(await gaoshuDays(page)).toEqual([0, 2]);

  const body = await bodyBox(page);
  const mondayCard = page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "高等数学" })
    .first();
  const from = await mondayCard.boundingBox();
  const to = targetPoint(body!, 4, 12 * 60);

  await dragMouse(page, { x: from!.x + from!.width / 2, y: from!.y + 3 }, to);

  // 已提交 + 可撤销
  await expect(page.getByText("课程时间已调整").first()).toBeVisible();
  await settle(page);
  // 现在分布在 周三 + 周五
  expect(await gaoshuDays(page)).toEqual([2, 4]);

  // 刷新后仍在 周五，且时间 ≈ 12:00（±25 分钟）
  await page.reload();
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByTestId("timetable-body")).toBeVisible();
  const body2 = await bodyBox(page);
  const cards = page.locator('[data-testid="schedule-card"]').filter({ hasText: "高等数学" });
  let fridayBox: { y: number; height: number } | null = null;
  for (let i = 0; i < await cards.count(); i++) {
    const box = await cards.nth(i).boundingBox();
    if (box && body2) {
      const day = Math.floor(((box.x + box.width / 2) - body2.x) / body2.width * 7);
      if (day === 4) fridayBox = box;
    }
  }
  expect(fridayBox).not.toBeNull();
  const fridayStartMin =
    BODY_TOP_MINUTES + ((fridayBox!.y - body2!.y) / body2!.height) * BODY_TOTAL_MINUTES;
  expect(Math.abs(fridayStartMin - 12 * 60)).toBeLessThanOrEqual(25);
});

test("Undo：拖后点击撤销，原星期/时间恢复", async ({ page }) => {
  await openWorkspace(page);

  const body = await bodyBox(page);
  const mondayCard = page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "高等数学" })
    .first();
  const from = await mondayCard.boundingBox();
  const to = targetPoint(body!, 4, 12 * 60);

  await dragMouse(page, { x: from!.x + from!.width / 2, y: from!.y + 3 }, to);
  await expect(page.getByText("课程时间已调整").first()).toBeVisible();
  await settle(page);
  expect(await gaoshuDays(page)).toEqual([2, 4]);

  await page.getByRole("button", { name: "撤销" }).click();
  await settle(page);
  // 撤销：同一 schedule，原 周一 10:00–11:40
  expect(await gaoshuDays(page)).toEqual([0, 2]);
  await expect(page.getByText("课程时间已调整")).toHaveCount(0);
});

test("Conflict：拖到已占用时间，pointerup 不保存并提示", async ({ page }) => {
  await openWorkspace(page);

  const body = await bodyBox(page);
  const mondayCard = page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "高等数学" })
    .first();
  const from = await mondayCard.boundingBox();

  // 拖到 周一 08:00（微观经济学 08:00–09:40 占用）
  const to = targetPoint(body!, 0, 8 * 60);
  await dragMouse(page, { x: from!.x + from!.width / 2, y: from!.y + 20 }, to);

  // 冲突提示，未保存
  await expect(page.getByText("与《微观经济学》时间冲突，未调整").first()).toBeVisible();
  expect(await gaoshuDays(page)).toEqual([0, 2]);
  await expect(page.getByText("课程时间已调整")).toHaveCount(0);
});

test("Mobile <768：点击课程卡仍进入 Course Drawer，不触发拖动", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // 底部导航进入课表页
  await page.locator('nav[aria-label="底部导航"]').getByRole("button", { name: "时间表" }).click();
  await expect(page.getByText(/第 \d+ 周/).first()).toBeVisible();

  const card = page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "高等数学" })
    .first();
  await card.click();
  // Course Drawer 打开（无拖动发生，未出现调整提示）
  await expect(page.getByRole("button", { name: "关闭" })).toBeVisible();
  await expect(page.getByText("课程时间已调整")).toHaveCount(0);
});

test("Resize：拉底部把手，结束时间 15 分钟吸附，刷新后仍在", async ({ page }) => {
  await openWorkspace(page);

  const body = await bodyBox(page);
  const mondayCard = page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "高等数学" })
    .first();
  const handle = mondayCard.locator('[data-testid="resize-handle"]');
  await expect(handle).toBeVisible();
  const handleBox = await handle.boundingBox();

  // 10:00–11:40 → 拉到底部 14:00 → 10:00–14:00
  const target = targetPoint(body!, 0, 14 * 60);
  await dragMouse(
    page,
    { x: handleBox!.x + handleBox!.width / 2, y: handleBox!.y + handleBox!.height / 2 },
    target
  );

  await expect(page.getByText("课程时间已调整").first()).toBeVisible();
  await settle(page);

  const resized = await mondayCard.boundingBox();
  const expectedHeight = (body!.height * (240 / BODY_TOTAL_MINUTES * 100 - 0.3) / 100);
  expect(Math.abs(resized!.height - expectedHeight)).toBeLessThanOrEqual(10);

  // 刷新后仍保持
  await page.reload();
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByTestId("timetable-body")).toBeVisible();
  const body2 = await bodyBox(page);
  const cardAfter = page
    .locator('[data-testid="schedule-card"]')
    .filter({ hasText: "高等数学" })
    .first();
  const boxAfter = await cardAfter.boundingBox();
  const expectedAfter = (body2!.height * (240 / BODY_TOTAL_MINUTES * 100 - 0.3) / 100);
  expect(Math.abs(boxAfter!.height - expectedAfter)).toBeLessThanOrEqual(10);
});
