import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * App Chrome V2.1.1 — Sidebar Layout Regression Geometry E2E。
 * 只断言最终静态几何（不测毫秒/过渡），按 V2.1.1 规范：
 * - Collapsed：所有 Nav icon / Kiro / Avatar 视觉中心 ≈ Sidebar 中心（≤2px）
 * - Expanded：Full Logo 恢复 V2 baseline 尺寸；MAIN nav icon 同一左侧视觉轴（≤1px）
 * - Avatar 32×32 真圆；无横向内容溢出（排除 out-of-flow tooltip 后的真实内容）
 */

const MAIN_LABELS = ["总览", "时间表", "任务与 DDL", "课程资料", "学习洞察", "小组协作"];
const ACTION_LABELS = ["提醒", "设置"];

async function openDesktop(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

async function sidebarCenterX(page: Page): Promise<number> {
  const box = (await page.getByTestId("app-sidebar").boundingBox())!;
  return box.x + box.width / 2;
}

async function iconCenterX(page: Page, label: string): Promise<number> {
  const box = await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: label })
    .locator("img, svg")
    .first()
    .boundingBox();
  return box!.x + box!.width / 2;
}

/** 隐藏 out-of-flow tooltip 后测量行内真实内容的横向溢出（tooltip 是设计内越界元素，不计入） */
async function contentOverflowPx(page: Page, selector: string): Promise<number> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return -1;
    for (const t of Array.from(el.querySelectorAll('[role="tooltip"]'))) {
      (t as HTMLElement).style.display = "none";
    }
    return el.scrollWidth - el.clientWidth;
  }, selector);
}

test("TEST 1+2+3：Collapsed 下 Nav / Kiro / Avatar 全部对中 Sidebar（≤2px），Avatar 32×32 真圆", async ({ page }) => {
  await openDesktop(page);
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  // 等待 morph 最终几何
  await expect.poll(async () => (await page.getByTestId("app-sidebar").boundingBox())!.width, { timeout: 5000 }).toBeLessThan(65);

  const center = await sidebarCenterX(page);

  // MAIN_NAV + Global Actions
  for (const label of [...MAIN_LABELS, ...ACTION_LABELS]) {
    const c = await iconCenterX(page, label);
    expect(Math.abs(c - center), `${label} icon center ${c} vs sidebar ${center}`).toBeLessThanOrEqual(2);
  }

  // Kiro：outer / inner / icon 三同心（≤2px）
  const kiro = page.getByTestId("app-sidebar").getByRole("button", { name: "Kiro" });
  const outer = (await kiro.boundingBox())!;
  const inner = (await kiro.locator("span").nth(1).boundingBox())!;
  const kiroIcon = (await kiro.locator("img, svg").first().boundingBox())!;
  for (const [name, c] of [["outer", outer.x + outer.width / 2], ["inner", inner.x + inner.width / 2], ["icon", kiroIcon.x + kiroIcon.width / 2]] as const) {
    expect(Math.abs(c - center), `Kiro ${name} center ${c} vs sidebar ${center}`).toBeLessThanOrEqual(2);
  }

  // Avatar：32×32 真圆 + 居中
  const avatar = (await page
    .getByTestId("app-sidebar")
    .locator(".sidebar-profile-avatar-slot img, .sidebar-profile-avatar-slot span")
    .first()
    .boundingBox())!;
  expect(Math.abs(avatar.width - avatar.height), `avatar ${avatar.width}×${avatar.height}`).toBeLessThanOrEqual(1);
  expect(avatar.width).toBeGreaterThanOrEqual(30);
  expect(avatar.width).toBeLessThanOrEqual(34);
  expect(Math.abs(avatar.x + avatar.width / 2 - center)).toBeLessThanOrEqual(2);
});

test("TEST 4：Collapsed 无横向内容溢出（nav row / kiro inner / profile surface）", async ({ page }) => {
  await openDesktop(page);
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await page.getByTestId("app-sidebar").boundingBox())!.width, { timeout: 5000 }).toBeLessThan(65);

  // 每个 nav row 逐一检查（隐藏 tooltip / Kiro 装饰 ring 后：label max-width 0 / margin 0 不应残留几何）
  for (const label of [...MAIN_LABELS, ...ACTION_LABELS, "Kiro"]) {
    const overflow = await page
      .getByTestId("app-sidebar")
      .getByRole("button", { name: label })
      .evaluate((el) => {
        for (const t of Array.from(el.querySelectorAll('[role="tooltip"]'))) {
          (t as HTMLElement).style.display = "none";
        }
        // Kiro 装饰流光 ring（-inset-1/2）按设计越界并被 overflow-hidden 视觉裁剪；不计入内容溢出
        for (const r of Array.from(el.querySelectorAll(".kiro-ring"))) {
          (r as HTMLElement).style.display = "none";
        }
        return el.scrollWidth - el.clientWidth;
      });
    expect(overflow, `${label} overflow ${overflow}px`).toBeLessThanOrEqual(1);
  }

  const profileOverflow = await contentOverflowPx(page, ".sidebar-profile-surface");
  expect(profileOverflow).toBeLessThanOrEqual(1);
  const kiroInnerOverflow = await contentOverflowPx(page, ".sidebar-nav-row-kiro");
  expect(kiroInnerOverflow).toBeLessThanOrEqual(1);
});

test("TEST 5：Expanded Full Logo 恢复 V2 baseline 尺寸（180×40 附近，不再被 max-h-8 缩小）", async ({ page }) => {
  await openDesktop(page);
  const logo = (await page.locator('[data-testid="app-sidebar"] .sidebar-logo-full').boundingBox())!;
  // /logo.png 952×213 → max-w-180 渲染 ≈ 180×40
  expect(logo.width).toBeGreaterThanOrEqual(165);
  expect(logo.width).toBeLessThanOrEqual(182);
  expect(logo.height).toBeGreaterThanOrEqual(36);
  expect(logo.height).toBeLessThanOrEqual(44);
  // 不裁切：渲染尺寸 = 原始宽高比
  expect(Math.abs(logo.width / logo.height - 952 / 213)).toBeLessThan(0.1);
});

test("TEST 6：Expanded MAIN nav icon 同一左侧视觉轴（≤1px）；actions 同轴", async ({ page }) => {
  await openDesktop(page);
  const centers = await Promise.all(
    [...MAIN_LABELS, ...ACTION_LABELS].map(async (label) => iconCenterX(page, label))
  );
  const base = centers[0];
  for (let i = 1; i < centers.length; i++) {
    expect(Math.abs(centers[i] - base), `${MAIN_LABELS[i] ?? "action"} icon axis ${centers[i]} vs ${base}`).toBeLessThanOrEqual(1);
  }
});
