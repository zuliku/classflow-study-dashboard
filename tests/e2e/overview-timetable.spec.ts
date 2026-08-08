import { test, expect } from "@playwright/test";

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

  // 高度明显小于 comfortable（520px body）版本
  expect(cardBox!.height).toBeLessThan(560);
  expect(cardBox!.height).toBeGreaterThan(400);

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
  const cardBox = await page.getByTestId("timetable-card").boundingBox();
  expect(cardBox!.height).toBeLessThan(560);
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
  await page.getByRole("button", { name: "我的课表" }).first().click();
  await expect(page.getByRole("heading", { name: "学期课表" })).toBeVisible();

  // workspace 保持舒展：body min-h 520（未加 md:min-h-[440px]）
  const body = await page
    .getByTestId("timetable-card")
    .locator("div.relative.flex-1.grid.grid-cols-8")
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(body).toBeGreaterThanOrEqual(520);
});
