import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Reminder Center Floating Panel + Motion（2026-08-14 spec/plan）。
 * 覆盖：桌面有界浮窗几何、移动端 12px 边距、exit presence、composer presence、
 * Esc/outside/X 关闭、大列表仅中间滚动。
 */

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

async function openDesktop(page: Page): Promise<ReturnType<Page["getByTestId"]>> {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel = page.getByTestId("reminder-center");
  await expect(panel).toHaveAttribute("data-state", "open", { timeout: 5000 });
  return panel;
}

async function openMobile(page: Page): Promise<ReturnType<Page["getByTestId"]>> {
  await page.setViewportSize(MOBILE);
  await page.goto("/");
  await page.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "提醒", exact: true }).click();
  const panel = page.getByTestId("reminder-center");
  await expect(panel).toHaveAttribute("data-state", "open", { timeout: 5000 });
  return panel;
}

/** 构造 16 个未来 scheduled standalone reminders（大列表滚动契约） */
function buildManyReminders() {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T10:00:00`;
  const reminders = [];
  for (let i = 0; i < 16; i++) {
    const d = new Date(now.getTime() + (i + 1) * 86400000);
    reminders.push({
      id: `r_many_${i}`,
      title: `大列表提醒 ${i}`,
      note: undefined,
      targetType: "standalone",
      timingMode: "absolute",
      triggerAt: iso(d),
      status: "scheduled",
      source: "manual",
      createdAt: iso(now),
      updatedAt: iso(now),
    });
  }
  return reminders;
}

test("Desktop：Reminder Center 是有界浮窗而非全高 Drawer", async ({ page }) => {
  const panel = await openDesktop(page);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  // 宽度 ≈ 400（360–430 tolerance）
  expect(box!.width).toBeGreaterThanOrEqual(360);
  expect(box!.width).toBeLessThanOrEqual(430);
  // 高度明显小于视口（不能 inset-y-0 全高）
  expect(box!.height).toBeLessThan(DESKTOP.height - 40);
  // 上下有空气（不贴顶不贴底）
  expect(box!.y).toBeGreaterThan(8);
  expect(box!.y + box!.height).toBeLessThan(DESKTOP.height - 8);
});

test("Mobile：四周约 12px 边距、无横向溢出、非全屏 sheet", async ({ page }) => {
  const panel = await openMobile(page);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(8);
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(MOBILE.width - (box!.x + box!.width)).toBeGreaterThanOrEqual(8);
  expect(MOBILE.height - (box!.y + box!.height)).toBeGreaterThanOrEqual(8);
  // 高度小于视口（非全屏）
  expect(box!.height).toBeLessThan(MOBILE.height - 16);
  // 无横向溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("关闭：data-state=exiting 后仍 mounted，随后 unmount（不是硬消失）", async ({ page }) => {
  const panel = await openDesktop(page);
  await panel.getByRole("button", { name: "关闭提醒中心" }).click();
  await expect(panel).toHaveAttribute("data-state", "exiting");
  // 退出中仍在 DOM（exit 帧可播放）
  await expect(panel).toHaveCount(1);
  await expect(panel).toHaveCount(0, { timeout: 5000 });
});

test("Escape 与 outside click 都能关闭（exit presence 同样生效）", async ({ page }) => {
  const panel = await openDesktop(page);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveAttribute("data-state", "exiting");
  await expect(panel).toHaveCount(0, { timeout: 5000 });

  await openDesktop(page);
  const panel2 = page.getByTestId("reminder-center");
  await page.mouse.click(DESKTOP.width - 40, 40); // panel 外（右上角）
  await expect(panel2).toHaveAttribute("data-state", "exiting");
  await expect(panel2).toHaveCount(0, { timeout: 5000 });
});

test("Composer：新建/取消 有 entering→open→exiting 生命周期（非硬切）", async ({ page }) => {
  const panel = await openDesktop(page);
  await panel.getByRole("button", { name: "新建提醒", exact: true }).first().click();
  const composer = page.getByTestId("reminder-composer");
  await expect(composer).toHaveAttribute("data-state", "open", { timeout: 5000 });
  await expect(composer.getByLabel("提醒内容")).toBeVisible();

  await composer.getByRole("button", { name: "取消", exact: true }).click();
  await expect(composer).toHaveAttribute("data-state", "exiting");
  await expect(composer).toHaveCount(1);
  await expect(composer).toHaveCount(0, { timeout: 5000 });
});

test("大列表：Panel 不超过 max 边界，只有中间列表滚动，Header 固定可见", async ({ page }) => {
  await page.addInitScript(({ reminders }) => {
    const KEY = "classflow-storage-v2";
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        data.state.reminders = reminders;
        localStorage.setItem(KEY, JSON.stringify(data));
      }
    } catch {
      /* noop */
    }
  }, { reminders: buildManyReminders() });

  const panel = await openDesktop(page);
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  // 有界：不超视口且明显小于视口高度
  expect(box!.height).toBeLessThanOrEqual(DESKTOP.height - 16);
  // Header 固定可见（panel 内顶部）
  const header = page.getByTestId("reminder-center-header");
  await expect(header).toBeVisible();
  // 列表区域自身滚动
  const list = page.getByTestId("reminder-center-list");
  const scrollable = await list.evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);
  const listOverflow = await list.evaluate((el) => getComputedStyle(el).overflowY);
  expect(listOverflow).toBe("auto");
});

test("Reduced Motion：打开/关闭接近即时（presence 不等待 exit 时长）", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  const panel = page.getByTestId("reminder-center");
  await expect(panel).toHaveAttribute("data-state", "open", { timeout: 3000 });
  await panel.getByRole("button", { name: "关闭提醒中心" }).click();
  // reduced：立即 unmount（不等待 170ms exit 时长）
  await expect(panel).toHaveCount(0, { timeout: 1000 });
});

test("打开仍执行 markAllFiredRemindersRead（unread dot 消失，语义不破坏）", async ({ page }) => {
  const now = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T10:00:00`;
  const yesterday = new Date(now.getTime() - 86400000);
  const firedUnread = {
    id: "r_fired_unread",
    title: "已触发未读提醒",
    note: undefined,
    targetType: "standalone" as const,
    timingMode: "absolute" as const,
    triggerAt: iso(yesterday),
    status: "fired" as const,
    firedAt: iso(yesterday),
    readAt: undefined,
    source: "manual" as const,
    createdAt: iso(yesterday),
    updatedAt: iso(yesterday),
  };
  await page.addInitScript(({ reminder }) => {
    const KEY = "classflow-storage-v2";
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const data = JSON.parse(raw);
        data.state.reminders = [reminder];
        localStorage.setItem(KEY, JSON.stringify(data));
      }
    } catch {
      /* noop */
    }
  }, { reminder: firedUnread });
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await expect(page.getByTestId("reminder-unread-dot")).toBeVisible();
  await page.getByRole("button", { name: "提醒", exact: true }).click();
  await expect(page.getByTestId("reminder-unread-dot")).toHaveCount(0, { timeout: 5000 });
});
