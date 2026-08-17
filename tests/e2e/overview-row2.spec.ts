import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

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

  // 右侧总高 = Upcoming + 16px gap（gap-4）+ MiniCalendar
  const rightTotal = upcoming!.height + 16 + calendar!.height;
  expect(Math.abs(timetable!.height - rightTotal)).toBeLessThanOrEqual(2);

  // 顶部对齐 / 底部对齐
  expect(Math.abs(timetable!.y - upcoming!.y)).toBeLessThanOrEqual(2);
  expect(
    Math.abs(
      timetable!.y + timetable!.height - (calendar!.y + calendar!.height)
    )
  ).toBeLessThanOrEqual(2);

  // MiniCalendar 高于 UpcomingDDL（固定 410px vs 右栏剩余空间）
  expect(calendar!.height).toBeGreaterThan(upcoming!.height);

  // 时间轴完整：08:00 / 21:00 可见且 21:00 未裁切
  // （时间列 = timetable-body 所在 grid 的第一列；Header/页面其它位置的隐藏 tooltip 也可能含「08:00/21:00」纯文本）
  const timeColumn = page
    .locator('[data-testid="timetable-body"]')
    .locator("xpath=..")
    .locator(":scope > div")
    .first();
  await expect(timeColumn).toBeVisible();
  await expect(timeColumn.getByText("08:00", { exact: true })).toBeVisible();
  const t2100 = await timeColumn.getByText("21:00", { exact: true }).boundingBox();
  expect(t2100!.y + t2100!.height).toBeLessThanOrEqual(timetable!.y + timetable!.height + 1);
});

test("UpcomingDDL 分页（ddlWarningDays=7）：5 条 → 每页 3 条（1 / 2），翻页替换内容且卡片高度不变", async ({ page }) => {
  await setWarningDays(page, 7);
  const card = page.getByTestId("upcoming-ddl-card");

  // 第一页：a1/a2/a3（计量经济学 / 市场营销 / 英语演讲）+ 分页 1 / 2
  await expect(card.getByText("数据库实验报告（实验四）")).toHaveCount(0);
  await expect(card.getByText("计量经济学大作业（第3章）")).toBeVisible();
  await expect(card.getByText("市场营销案例汇报")).toBeVisible();
  await expect(card.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "上一页" })).toBeDisabled();

  const base = await card.boundingBox();

  // 下一页：a4/a5 出现，第一页条目消失
  await card.getByRole("button", { name: "下一页" }).click();
  await expect(card.getByText("数据库实验报告（实验四）")).toBeVisible();
  await expect(card.getByText("微观经济学课后习题（第5章）")).toBeVisible();
  await expect(card.getByText("计量经济学大作业（第3章）")).toHaveCount(0);
  await expect(card.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "下一页" })).toBeDisabled();

  // 翻页不改变卡片高度（列表区 flex 分配稳定）
  await page.waitForTimeout(200);
  const after = await card.boundingBox();
  expect(Math.abs(after!.height - base!.height)).toBeLessThanOrEqual(1);

  // 返回上一页（第 2 → 第 1 页）
  await card.getByRole("button", { name: "上一页" }).click();
  await expect(card.getByText("1 / 2", { exact: true })).toBeVisible();
});

test("UpcomingDDL 默认 3 天窗口：仅前 2-3 条（时间敏感）→ 不显示分页控件", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("upcoming-ddl-card");
  // 默认 ddlWarningDays=3：a1/a2 恒在窗口；深夜时段 a3（+4d 21:00 差值为 3）也可能进入，
  // 但始终 ≤ 3 条 → 无分页控件
  await expect(card.getByText(/[23] 项待办/)).toBeVisible();
  // footer 恒显；≤3 条时无分页按钮
  await expect(
    page.getByTestId("upcoming-ddl-pagination").getByRole("button", { name: /上一页|下一页/ })
  ).toHaveCount(0);
});

test("Mobile 390：单列自然排布，DDL 默认窗口生效", async ({ page }) => {
  await openOverview(page, 390, 844);
  await expect(page.getByTestId("upcoming-ddl-card")).toBeVisible();

  // 单列：upcoming 卡片在课表下方自然排布（不强制等高）
  const upcoming = await page.getByTestId("upcoming-ddl-card").boundingBox();
  const timetable = await page.getByTestId("timetable-card").boundingBox();
  expect(upcoming!.y).toBeGreaterThanOrEqual(timetable!.y + timetable!.height - 5);

  // 默认 3 天窗口：≤3 条，无分页按钮
  await expect(page.getByTestId("upcoming-ddl-card").getByText(/[23] 项待办/)).toBeVisible();
  await expect(
    page.getByTestId("upcoming-ddl-pagination").getByRole("button", { name: /上一页|下一页/ })
  ).toHaveCount(0);
});

test("1024×768 Tablet：双栏等高", async ({ page }) => {
  await openOverview(page, 1024, 768);
  const timetable = await page.getByTestId("timetable-card").boundingBox();
  const upcoming = await page.getByTestId("upcoming-ddl-card").boundingBox();
  const calendar = await page.getByTestId("calendar-card").boundingBox();

  const rightTotal = upcoming!.height + 16 + calendar!.height;
  expect(Math.abs(timetable!.height - rightTotal)).toBeLessThanOrEqual(2);
});

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** 按 seed 同一套「今天 + 偏移」本地墙钟推算预期 tile 文案（与 parseLocalDDL 同源） */
function expectedTile(dayOffset: number) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  return {
    month: `${d.getMonth() + 1}月`,
    day: String(d.getDate()),
    weekday: WEEKDAY_LABELS[d.getDay()],
  };
}

test("Date Anchor：tile 月/日/星期与本地 DDL 一致，HH:mm 右移，旧日期行不再重复", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("upcoming-ddl-card");

  // 演示数据 a1 = 明天 23:59、a2 = 后天 18:00（都在默认 3 天窗口内）
  const a1 = expectedTile(1);
  const a2 = expectedTile(2);
  const tile1 = card.getByTestId("upcoming-ddl-date-a1");
  const tile2 = card.getByTestId("upcoming-ddl-date-a2");
  await expect(tile1).toBeVisible();
  await expect(tile1).toContainText(a1.month);
  await expect(tile1).toContainText(a1.day);
  await expect(tile1).toContainText(a1.weekday);
  await expect(tile2).toContainText(a2.month);
  await expect(tile2).toContainText(a2.day);
  await expect(tile2).toContainText(a2.weekday);

  // 精确时间移到右侧 secondary meta（23:59 / 18:00）
  await expect(card.getByText("23:59", { exact: true })).toBeVisible();
  await expect(card.getByText("18:00", { exact: true })).toBeVisible();
  // 原「M月d日 · HH:mm」合并日期行不再展示
  await expect(card.getByText(/\d+月\d+日 · \d{2}:\d{2}/)).toHaveCount(0);

  // relative time 仍在（zhCN 输出如「1 天内」）
  await expect(card.getByText(/明天|后天|\d+ ?天内|小时内|分钟内/).first()).toBeVisible();

  // title / course / priority 仍在
  await expect(card.getByText("计量经济学大作业（第3章）")).toBeVisible();
  await expect(card.getByText("市场营销案例汇报")).toBeVisible();
  await expect(card.getByText("计量经济学", { exact: false }).first()).toBeVisible();

  // tile 尺寸 ≈ 46×56（compact anchor，不是大卡）
  const box = await tile1.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(42);
  expect(box!.width).toBeLessThanOrEqual(50);
  expect(box!.height).toBeGreaterThanOrEqual(52);
  expect(box!.height).toBeLessThanOrEqual(60);
});

test("Date Anchor：点击 Task Card 仍打开 Assignment Detail（键盘 Enter 同步）", async ({ page }) => {
  await openOverview(page);
  const card = page.getByTestId("upcoming-ddl-card");
  const item = card.getByText("计量经济学大作业（第3章）");
  await item.click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("dialog", { name: "任务详情" }).getByRole("button", { name: "关闭" }).click();
  await expect(page.getByRole("dialog", { name: "任务详情" })).toHaveCount(0);

  // 键盘 Enter 激活同链路
  await card.getByText("市场营销案例汇报").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible({ timeout: 8000 });
});

test("Date Anchor：长标题 truncate 不溢出（tile/relative 不被推走）", async ({ page }) => {
  await openOverview(page);
  // 注入超长标题（先触发 persist 写入再修改）
  await page.evaluate(() => {
    const key = "classflow-storage-v2";
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const state = parsed?.state ?? parsed;
    if (!state) return;
    const long = "关于新能源产业政策与区域经济协同发展的课程论文初稿（含数据分析与政策建议部分）";
    state.assignments = (state.assignments ?? []).map((a: { id: string }) =>
      a.id === "a1" ? { ...a, title: long } : a
    );
    localStorage.setItem(key, JSON.stringify({ state, version: 7 }));
  });
  await page.reload();
  await expect(page.getByTestId("timetable-card")).toBeVisible();
  await page.waitForTimeout(400);

  const card = page.getByTestId("upcoming-ddl-card");
  const item = card.locator('div[role="button"]').filter({ hasText: "课程论文初稿" }).first();
  await expect(item).toBeVisible();
  // 无横向溢出（卡片 scrollWidth == clientWidth）
  const overflow = await item.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // tile 与右侧 relative 仍在视内
  await expect(item.getByTestId("upcoming-ddl-date-a1")).toBeVisible();
  await expect(item.getByText(/明天|后天|\d+ ?天内|小时内|分钟内/).first()).toBeVisible();
});
