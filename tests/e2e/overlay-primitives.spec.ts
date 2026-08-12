import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 2B2 overlay 回归：共享 Dialog/Drawer primitive 的关键跨 surface 行为。
 * Case A：Drawer + Confirm topmost stack（z40/z60 + 两次 Esc）
 * Case B：Settings backdrop close + panel 内点击不关闭
 * Case C：Timeline ArrangeSheet backdrop close / MarkSheet Esc close
 */

test("Case A：Drawer + Confirm 嵌套栈（Esc 先关 Confirm 再关 Drawer）", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  // 打开课程 Drawer（Overview 课程卡）
  await page.getByRole("heading", { name: "微观经济学" }).first().click();
  await expect(page.getByRole("dialog", { name: "课程详情" })).toBeVisible();

  // 触发删除课程 → ConfirmDialog（不真正确认）
  await page.getByRole("button", { name: "删除课程" }).first().click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();

  // 第一次 Esc：只关闭 Confirm，Drawer 仍在
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "课程详情" })).toBeVisible();

  // 第二次 Esc：关闭 Drawer
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "课程详情" })).toHaveCount(0);
});

test("Case B：Settings backdrop close；面板内点击不关闭", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();

  // 面板内点击不关闭
  await dialog.locator("h2", { hasText: "设置" }).click();
  await expect(dialog).toBeVisible();

  // Escape 关闭
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // 重新打开 → backdrop 点击关闭
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(10, 10); // 面板外（backdrop）
  await expect(dialog).toHaveCount(0);
});

test("Case C：Timeline ArrangeSheet backdrop close；MarkSheet Esc close", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "时间表" }).first().click();
  await expect(page.getByRole("heading", { name: "时间表" })).toBeVisible();

  // 新建 → 学习计划
  await page.getByRole("button", { name: "新建" }).click();
  await page.getByRole("menu", { name: "新建" }).getByRole("menuitem", { name: "学习计划" }).click();
  const arrange = page.getByRole("dialog", { name: "安排学习计划" });
  await expect(arrange).toBeVisible();
  // backdrop 点击关闭
  await page.mouse.click(12, 12);
  await expect(arrange).toHaveCount(0);

  // 新建 → 考试 / 日程
  await page.getByRole("button", { name: "新建" }).click();
  await page.getByRole("menu", { name: "新建" }).getByRole("menuitem", { name: "考试 / 日程" }).click();
  const mark = page.getByRole("dialog", { name: "添加考试或日程" });
  await expect(mark).toBeVisible();
  // Esc 关闭
  await page.keyboard.press("Escape");
  await expect(mark).toHaveCount(0);
});
