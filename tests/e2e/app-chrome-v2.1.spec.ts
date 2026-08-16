import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * App Chrome V2.1 — Sidebar Rail Morph + Motion State E2E：
 * 1) Collapse / Expand 最终几何（宽度、labels、logo、profile、main reflow）
 * 2) 持久化双向（collapse / expand → reload）
 * 3) Hydration Guard：刷新不进入 manual morph，不播放启动动画
 * 4) Responsive：1024 强制 rail 且不进入 manual；切回 ≥1280 恢复 persisted
 * 5) Rapid Toggle：快速连续点击最终状态正确、无 stuck motion
 * 6) Reduced Motion：瞬时切换，data-motion-active 不进入 manual
 * 7) Active Plate 折叠/展开后正确
 * 不测精确毫秒数（测最终几何与状态属性）。
 */

async function openDesktop(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

function motionState(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="app-sidebar"]');
    if (!el) return null;
    return {
      collapsed: el.getAttribute("data-collapsed"),
      motionActive: el.getAttribute("data-motion-active"),
      direction: el.getAttribute("data-motion-direction"),
      resolved: el.getAttribute("data-viewport-resolved"),
      width: el.getBoundingClientRect().width,
    };
  });
}

test("Collapse：64px + labels 不可见 + mark 可见 + 主工作区变宽；Expand 恢复", async ({ page }) => {
  await openDesktop(page);
  const sidebar = page.getByTestId("app-sidebar");
  const main = page.locator("main");
  const expandedMainWidth = (await main.boundingBox())!.width;

  // Collapse
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await motionState(page))!.width).toBeCloseTo(64, 0);
  await expect(page.getByTestId("nav-label").first()).toBeHidden();
  // motion 回落 idle（transitionend 清空）
  await expect.poll(async () => (await motionState(page))!.motionActive).toBe("false");
  // 主工作区变宽
  const collapsedMainWidth = (await main.boundingBox())!.width;
  expect(collapsedMainWidth).toBeGreaterThan(expandedMainWidth + 100);

  // Expand
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect.poll(async () => (await motionState(page))!.width).toBeCloseTo(224, 0);
  await expect(page.getByTestId("nav-label").first()).toBeVisible();
  await expect.poll(async () => (await motionState(page))!.motionActive).toBe("false");
});

test("Hydration Guard：刷新后最终展开且不进入 manual motion", async ({ page }) => {
  await openDesktop(page);
  // 默认展开
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "false");

  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  const s = await motionState(page);
  expect(s!.collapsed).toBe("false");
  expect(s!.motionActive).toBe("false"); // 无启动 morph
  expect(s!.direction).toBeNull();
  expect(s!.resolved).toBe("true");
  expect(s!.width).toBeCloseTo(224, 0);
});

test("Persist 双向：collapse→reload→仍折叠；expand→reload→仍展开", async ({ page }) => {
  await openDesktop(page);

  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");

  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "false");
  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "false");
});

test("Responsive：1024 强制 rail 且无 manual motion；切回 ≥1280 恢复 persisted", async ({ page }) => {
  await openDesktop(page);
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "false");

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  const rail = await motionState(page);
  expect(rail!.width).toBeCloseTo(64, 0);
  expect(rail!.motionActive).toBe("false"); // 断点变化不进入 manual morph

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "false");
  const restored = await motionState(page);
  expect(restored!.motionActive).toBe("false");
  expect(restored!.width).toBeCloseTo(224, 0);
});

test("Rapid Toggle：快速 collapse → expand → collapse 最终状态正确、无 stuck motion", async ({ page }) => {
  await openDesktop(page);
  const toggle = page.getByTestId("sidebar-collapse-toggle");

  await toggle.click();
  await toggle.click();
  await toggle.click();

  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await motionState(page))!.width, { timeout: 5000 }).toBeLessThan(65);
  await expect(page.getByTestId("nav-label").first()).toBeHidden();
  // 最终回落 idle（transitionend 清空；不残留 direction）
  await expect.poll(async () => (await motionState(page))!.motionActive).toBe("false");
  expect((await motionState(page))!.direction).toBeNull();
});

test("Reduced Motion：点击瞬时切换，不进入 manual morph", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openDesktop(page);

  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  const collapsed = await motionState(page);
  expect(collapsed!.motionActive).toBe("false"); // reduced 下不进入 manual
  expect(collapsed!.width).toBeCloseTo(64, 0);

  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "false");
  const expanded = await motionState(page);
  expect(expanded!.motionActive).toBe("false");
  expect(expanded!.width).toBeCloseTo(224, 0);
});

test("Active Plate：折叠/展开后 active 项与 plate 仍正确", async ({ page }) => {
  await openDesktop(page);
  const sidebar = page.getByTestId("app-sidebar");
  await sidebar.getByRole("button", { name: "总览" }).click();

  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("nav-active-plate")).toHaveClass(/opacity-100/);
  await expect(sidebar.getByRole("button", { name: "总览" })).toHaveAttribute(
    "aria-current",
    "page"
  );
  const plateYCollapsed = await page
    .getByTestId("nav-active-plate")
    .evaluate((el) => (el as HTMLElement).style.transform);

  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("nav-active-plate")).toHaveClass(/opacity-100/);
  const plateYExpanded = await page
    .getByTestId("nav-active-plate")
    .evaluate((el) => (el as HTMLElement).style.transform);
  // 纵向位置不抖动（仅宽度变化，Y 不变）
  expect(plateYExpanded).toBe(plateYCollapsed);
});
