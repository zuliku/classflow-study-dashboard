import { test, expect } from "@playwright/test";

/**
 * Reduced Motion QA：prefers-reduced-motion: reduce 下所有功能仍然可用，
 * 不依赖任何动画完成事件（动画被全局收敛到 ~0ms）。
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

test.describe("reduced motion", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("日历可选日期（indicator 仍就位，选中状态立即可见）", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const target = dPlus(3);
    await page.locator(`[data-calendar-day="${target}"]`).click();
    await expect(page.locator("[data-selected-date]")).toHaveAttribute(
      "data-selected-date",
      target
    );
    // indicator 立即就位（不依赖动画结束）
    const ind = await page.getByTestId("calendar-selection-indicator").boundingBox();
    expect(ind!.width).toBeGreaterThan(0);
    const cell = await page.locator(`[data-calendar-day="${target}"]`).boundingBox();
    expect(Math.abs(ind!.x - cell!.x) + Math.abs(ind!.y - cell!.y)).toBeLessThan(1);
    // agenda 更新
    const [, m, d] = target.split("-").map(Number);
    await expect(
      page.locator("main").getByText(new RegExp(`${m}月${d}日.*当日日程`)).first()
    ).toBeVisible();
  });

  test("导航可切换 Tab", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "课程资料" }).first().click();
    await expect(page.getByRole("heading", { name: "本学期课程" })).toBeVisible();
    await page.getByRole("button", { name: "我的课表" }).first().click();
    await expect(page.getByRole("heading", { name: "学期课表" })).toBeVisible();
  });

  test("课表仍可拖动（不依赖动画）", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "我的课表" }).first().click();
    await expect(page.getByTestId("timetable-body")).toBeVisible();
    const body = await page.getByTestId("timetable-body").boundingBox();
    const card = page
      .locator('[data-testid="schedule-card"]')
      .filter({ hasText: "高等数学" })
      .first();
    const from = await card.boundingBox();
    const to = {
      x: body!.x + (4.5 / 7) * body!.width,
      y: body!.y + ((12 * 60 - 8 * 60) / 780) * body!.height,
    };
    await page.mouse.move(from!.x + from!.width / 2, from!.y + 3);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText("课程时间已调整").first()).toBeVisible();
  });

  test("Modal 可开关", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "课程资料" }).first().click();
    await page.getByRole("button", { name: "添加课程" }).first().click();
    await expect(page.getByRole("heading", { name: "添加课程" })).toBeVisible();
    await page.getByRole("button", { name: "取消" }).first().click();
    await expect(page.getByRole("heading", { name: "添加课程" })).toHaveCount(0);
  });
});
