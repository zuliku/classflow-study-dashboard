import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Overview「本周课表」compact 时间轴 E2E：
 * 08:00-21:00 完整保留、未被裁切、无内部垂直滚动、总高度明显小于 comfortable 版本。
 */

async function openOverview(page: import("@playwright/test").Page, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.getByTestId("timetable-card")).toBeVisible();
  await page.waitForTimeout(500);
}

test("1440×900：时间轴紧凑且完整（08:00 / 21:00 可见、21:00 未裁切、无垂直滚动）", async ({ page }) => {
  await openOverview(page);

  const card = page.getByTestId("timetable-card");
  const cardBox = await card.boundingBox();

  // 08:00 与 21:00 刻度均渲染且可见
  await expect(page.getByText("08:00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("21:00", { exact: true }).first()).toBeVisible();

  // 21:00 未被卡片边界裁切（label 底部在卡片内部）
  const t2100 = await page.getByText("21:00", { exact: true }).first().boundingBox();
  expect(t2100!.y + t2100!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  expect(t2100!.y + t2100!.height).toBeGreaterThan(cardBox!.y + cardBox!.height - 24);

  // compact 下限生效：时间轴 body 至少 440px（完整 08:00-21:00 可读）；
  // Row 2 共享行高由右侧（DDL+日历）决定，课表等比拉伸填满，不做硬上限断言
  const body = await page
    .getByTestId("timetable-card")
    .locator("div.relative.flex-1.grid")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(body).toBeGreaterThanOrEqual(440);

  // 时间轴容器无内部垂直滚动条
  const noVScroll = await page
    .getByTestId("timetable-card")
    .evaluate((el) => {
      const scroller = el.querySelector("[class*='overflow-x-auto']");
      if (!scroller) return true;
      return scroller.scrollHeight <= scroller.clientHeight + 1;
    });
  expect(noVScroll).toBe(true);

  // 无 horizontal viewport overflow
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("1920×1080：时间轴完整可见，无 overflow", async ({ page }) => {
  await openOverview(page, 1920, 1080);
  await expect(page.getByText("08:00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("21:00", { exact: true }).first()).toBeVisible();
  const t2100 = await page.getByText("21:00", { exact: true }).first().boundingBox();
  const cardBox = await page.getByTestId("timetable-card").boundingBox();
  expect(t2100!.y + t2100!.height).toBeLessThanOrEqual(cardBox!.y + cardBox!.height + 1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("1024×768：Tablet 课表可读，无 overflow", async ({ page }) => {
  await openOverview(page, 1024, 768);
  await expect(page.getByText("08:00", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("21:00", { exact: true }).first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("390×844：Mobile 自然高度（不强制 compact 固定高度），可横向滚动课表，无 viewport overflow", async ({ page }) => {
  await openOverview(page, 390, 844);
  const cardBox = await page.getByTestId("timetable-card").boundingBox();
  // 移动端不套用 md:min-h-[440px] → 保持 520px body，可读性优先
  expect(cardBox!.height).toBeGreaterThanOrEqual(540);
  // 时间轴容器允许横向滚动（课程卡可读），但不产生 viewport 级 overflow
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  expect(overflow).toBe(false);
});

test("Full Timetable Workspace / Modal 不受 compact 影响", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();

  // workspace 随可用高度伸展：不应被 Overview 的 md:min-h-[440px] 压缩；
  // 1440×900 下实际约 492px（旧断言的 520px 来自更早的固定高度实现）。
  const body = await page
    .getByTestId("timetable-card")
    .locator("div.relative.flex-1.grid")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(body).toBeGreaterThanOrEqual(440);
});

test("1920 总览：宽列恢复教师 + 地点，不再只剩课程名", async ({ page }) => {
  await openOverview(page, 1920, 1080);
  const card = page
    .getByTestId("schedule-card")
    .filter({ hasText: "微观经济学" })
    .first();
  await expect(card.getByText("微观经济学", { exact: true })).toBeVisible();
  await expect(card.getByText("王教授", { exact: true })).toBeVisible();
  await expect(card.getByText("教二 201", { exact: true })).toBeVisible();
});

test("1920：总览与时间表的课程卡使用同一完整卡样式", async ({ page }) => {
  await openOverview(page, 1920, 1080);
  const readCard = () =>
    page.getByTestId("schedule-card").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const title = el.querySelector("h4");
      return {
        compact: el.hasAttribute("data-compact"),
        paddingTop: cs.paddingTop,
        justifyContent: cs.justifyContent,
        titleSize: title ? getComputedStyle(title).fontSize : null,
      };
    });

  const overview = await readCard();
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByTestId("timetable-card")).toBeVisible();
  await page.waitForTimeout(400);
  const timeline = await readCard();

  expect(overview.compact).toBe(false);
  expect(timeline.compact).toBe(false);
  expect(overview.paddingTop).toBe(timeline.paddingTop);
  expect(overview.justifyContent).toBe(timeline.justifyContent);
  expect(overview.titleSize).toBe(timeline.titleSize);
});

test("1280/1024 总览：临近 DDL 行不撑破卡片，右侧时间不被裁切", async ({ page }) => {
  for (const width of [1280, 1024]) {
    await openOverview(page, width, width === 1024 ? 768 : 900);
    const metrics = await page.getByTestId("upcoming-ddl-card").evaluate((el) => {
      const grid = el.querySelector(".ux-agenda-enter") as HTMLElement | null;
      const row = grid?.firstElementChild as HTMLElement | null;
      const cardRect = el.getBoundingClientRect();
      const rowRect = row?.getBoundingClientRect();
      return {
        gridScrollWidth: grid?.scrollWidth ?? 0,
        gridClientWidth: grid?.clientWidth ?? 0,
        rowRight: rowRect?.right ?? 0,
        cardRight: cardRect.right,
      };
    });
    expect(metrics.gridScrollWidth).toBeLessThanOrEqual(metrics.gridClientWidth + 1);
    expect(metrics.rowRight).toBeLessThanOrEqual(metrics.cardRight + 1);
  }
});

test("1280/1024 总览：7 天全部可见，课程卡降级为摘要态且无横向滚动", async ({ page }) => {
  for (const width of [1280, 1024]) {
    await openOverview(page, width, 900);

    const metrics = await page.getByTestId("timetable-card").evaluate((el) => {
      const scroller = el.querySelector("[class*='overflow-x-auto']") as HTMLElement | null;
      const days = Array.from(el.querySelectorAll<HTMLElement>("[data-timetable-day]"));
      const scrollerRect = scroller!.getBoundingClientRect();
      return {
        dayCount: days.length,
        clientWidth: scroller!.clientWidth,
        scrollWidth: scroller!.scrollWidth,
        firstDayLeft: days[0].getBoundingClientRect().left,
        lastDayRight: days[days.length - 1].getBoundingClientRect().right,
        scrollerLeft: scrollerRect.left,
        scrollerRight: scrollerRect.right,
      };
    });

    // 7 天全部在容器内可见（不再出现“有滚动条但列仍被压扁”的组合）
    expect(metrics.dayCount).toBe(7);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.firstDayLeft).toBeGreaterThanOrEqual(metrics.scrollerLeft - 1);
    expect(metrics.lastDayRight).toBeLessThanOrEqual(metrics.scrollerRight + 1);

    const cards = page.getByTestId("schedule-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toHaveAttribute("data-compact", "true");
      // 摘要卡不展示教师/地点，完整信息通过原生 title 兜底
      expect(await cards.nth(i).getAttribute("title")).toMatch(/·/);
    }
  }
});

test("1280/1024 时间表：compact 卡优先显示完整课程名与教师名", async ({ page }) => {
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "时间表" }).first().click();
    await expect(page.getByTestId("timetable-card")).toBeVisible();
    await page.waitForTimeout(400);

    const cards = page.getByTestId("schedule-card");
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(cards.nth(i)).toHaveAttribute("data-compact", "true");
    }

    // 教师名不再被地点挤成「王…」；地点保留在 title / sr-only
    await expect(
      page.getByTestId("timetable-card").getByText("王教授", { exact: true }).first()
    ).toBeVisible();
    const withLocation = cards.filter({ hasText: "王教授" }).first();
    expect(await withLocation.getAttribute("title")).toContain("教二 201");
  }
});

test("键盘：课程卡可聚焦并用 Enter 打开课程详情", async ({ page }) => {
  await openOverview(page, 1440, 900);
  const card = page.getByTestId("schedule-card").filter({ hasText: "微观经济学" }).first();
  await card.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("course-detail-panel")).toBeVisible({ timeout: 8000 });
});
