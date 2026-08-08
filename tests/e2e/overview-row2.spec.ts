import { test, expect, Page } from "@playwright/test";

/**
 * Overview Row 2 等高 + UpcomingDDL 3条/页分页 E2E。
 * 演示数据：a1-a4 在未来 7 天内（upcoming 4 条 → 2 页）。
 */

async function openOverview(page: Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.getByTestId("timetable-card")).toBeVisible();
  await page.waitForTimeout(700);
}

/** 通过 localStorage 注入 preferences.ddlWarningDays（先触发 persist 写入 demo 数据再修改） */
async function setWarningDays(page: Page, days: number) {
  await openOverview(page);
  await page.getByTestId("overview-tasks-wrap").getByRole("button", { name: "已逾期" }).click();
  await page.waitForTimeout(300);
  await page.evaluate((d) => {
    const key = "classflow-storage-v2";
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const state = parsed?.state ?? parsed;
    if (!state) return;
    state.preferences = { ...(state.preferences || {}), ddlWarningDays: d };
    localStorage.setItem(key, JSON.stringify({ state, version: 3 }));
  }, days);
  await page.reload();
  await expect(page.getByTestId("timetable-card")).toBeVisible();
  await page.waitForTimeout(400);
}

test("1440×900：左右等高（顶部/底部/总高 ≤2px），左侧时间轴填满无空白", async ({ page }) => {
  await openOverview(page);

  const timetable = await page.getByTestId("timetable-card").boundingBox();
  const upcoming = await page.getByTestId("upcoming-ddl-card").boundingBox();
  const calendar = await page.getByTestId("calendar-card").boundingBox();

  // 右侧总高 = Upcoming + 20px gap + MiniCalendar
  const rightTotal = upcoming!.height + 20 + calendar!.height;
  expect(Math.abs(timetable!.height - rightTotal)).toBeLessThanOrEqual(2);

  // 顶部对齐 / 底部对齐
  expect(Math.abs(timetable!.y - upcoming!.y)).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      timetable!.y + timetable!.height - (calendar!.y + calendar!.height)
    )
  ).toBeLessThanOrEqual(2);

  // MiniCalendar 明显高于 UpcomingDDL（剩余空间分配）
  expect(calendar!.height).toBeGreaterThan(upcoming!.height * 1.2);

  // 时间轴完整：08:00 / 21:00 可见且 21:00 未裁切
  await expect(page.getByText("08:00", { exact: true }).first()).toBeVisible();
  const t2100 = await page.getByText("21:00", { exact: true }).first().boundingBox();
  expect(t2100!.y + t2100!.height).toBeLessThanOrEqual(timetable!.y + timetable!.height + 1);
});

test("UpcomingDDL 分页（ddlWarningDays=7）：5 条 → 每页 2 条（1 / 3），翻页替换内容且卡片高度不变", async ({ page }) => {
  await setWarningDays(page, 7);
  const card = page.getByTestId("upcoming-ddl-card");

  // 第一页：2 条 + 分页 1 / 3
  await expect(card.getByText("数据库实验报告（实验四）")).toHaveCount(0);
  await expect(card.getByText("计量经济学大作业（第3章）")).toBeVisible();
  await expect(card.getByText("市场营销案例汇报")).toBeVisible();
  await expect(card.getByText("1 / 3", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "上一页" })).toBeDisabled();

  const base = await card.boundingBox();

  // 下一页：第 3-4 条出现，第一页条目消失
  await card.getByRole("button", { name: "下一页" }).click();
  await expect(card.getByText("英语演讲PPT (Unit 6)")).toBeVisible();
  await expect(card.getByText("数据库实验报告（实验四）")).toBeVisible();
  await expect(card.getByText("计量经济学大作业（第3章）")).toHaveCount(0);
  await expect(card.getByText("2 / 3", { exact: true })).toBeVisible();

  // 再下一页：最后 1 条（第 5 条）
  await card.getByRole("button", { name: "下一页" }).click();
  await expect(card.getByText("微观经济学课后习题（第5章）")).toBeVisible();
  await expect(card.getByText("3 / 3", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "下一页" })).toBeDisabled();

  // 翻页不改变卡片高度（列表区 min-h 固定 2 行）
  await page.waitForTimeout(200);
  const after = await card.boundingBox();
  expect(Math.abs(after!.height - base!.height)).toBeLessThanOrEqual(1);

  // 返回上一页（第 3 → 第 2 页）
  await card.getByRole("button", { name: "上一页" }).click();
  await expect(card.getByText("2 / 3", { exact: true })).toBeVisible();
});

test("UpcomingDDL 默认 3 天窗口：2 条 → 不显示分页控件", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("upcoming-ddl-card");
  // 默认 ddlWarningDays=3：仅 +1/+2 天任务（a1/a2）在窗口内
  await expect(card.getByText("2 项待办")).toBeVisible();
  await expect(page.getByTestId("upcoming-ddl-pagination")).toHaveCount(0);
});

test("Mobile 390：单列自然高度、无横向 overflow、DDL 默认窗口生效", async ({ page }) => {
  await openOverview(page, 390, 844);
  await expect(page.getByTestId("upcoming-ddl-card")).toBeVisible();

  // 单列：upcoming 卡片在课表下方自然排布（不强制等高）
  const upcoming = await page.getByTestId("upcoming-ddl-card").boundingBox();
  const timetable = await page.getByTestId("timetable-card").boundingBox();
  expect(upcoming!.y).toBeGreaterThanOrEqual(timetable!.y + timetable!.height - 5);

  // 默认 3 天窗口：2 条，无分页控件
  await expect(page.getByTestId("upcoming-ddl-card").getByText("2 项待办")).toBeVisible();
  await expect(page.getByTestId("upcoming-ddl-pagination")).toHaveCount(0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("1024×768 Tablet：双栏等高、无横向 overflow", async ({ page }) => {
  await openOverview(page, 1024, 768);
  const timetable = await page.getByTestId("timetable-card").boundingBox();
  const upcoming = await page.getByTestId("upcoming-ddl-card").boundingBox();
  const calendar = await page.getByTestId("calendar-card").boundingBox();

  const rightTotal = upcoming!.height + 20 + calendar!.height;
  expect(Math.abs(timetable!.height - rightTotal)).toBeLessThanOrEqual(2);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});
