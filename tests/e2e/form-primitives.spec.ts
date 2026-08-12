import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 2C 表单 smoke：AddAssignmentModal / AddCourseModal 使用统一 Form primitives 后
 * 关键 consumer 流程保持可用（业务语义未变）。
 */

async function openAssignmentModal(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "新增任务" }).first().click();
  const dialog = page.getByRole("dialog", { name: "添加任务" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("Add Assignment：标题/课程/优先级/DDL checkbox/date/time → 保存 → 任务创建成功", async ({ page }) => {
  const dialog = await openAssignmentModal(page);

  // DDL checkbox：点击可见的 checkbox 视觉框（label 内 span）
  const ddlLabel = dialog.locator('label:has(input[aria-label="设置截止时间"])');
  await ddlLabel.click();
  await expect(dialog.locator('input[type="date"]')).toBeVisible();
  await expect(dialog.locator('input[type="time"]')).toBeVisible();

  await dialog.getByLabel("任务名称").fill("Task 2C 冒烟任务");
  await dialog.getByRole("combobox", { name: "关联课程" }).click();
  await page.getByRole("option", { name: /微观经济学/ }).first().click();
  await dialog.getByRole("combobox", { name: "优先级" }).click();
  await page.getByRole("option", { name: "高优先级" }).first().click();
  await dialog.locator('input[type="date"]').fill("2026-09-01");
  await dialog.locator('input[type="time"]').fill("18:00");

  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Task 2C 冒烟任务").first()).toBeVisible();
});

test("Add Course：课程名称/时段 → 创建 → 课程创建成功", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.getByRole("button", { name: "添加课程" }).first().click();
  const dialog = page.getByRole("dialog", { name: "添加课程" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("课程名称").fill("Task 2C 冒烟课程");
  await dialog.getByPlaceholder("教师姓名").fill("测试老师");
  await dialog.getByRole("combobox", { name: "星期" }).click();
  await page.getByRole("option", { name: "周三" }).first().click();
  // 避开演示数据冲突时段（周一 08:00-09:40 已被占用）
  await dialog.locator('input[type="time"]').nth(0).fill("18:00");
  await dialog.locator('input[type="time"]').nth(1).fill("19:40");
  await dialog.getByRole("button", { name: "创建课程" }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Task 2C 冒烟课程").first()).toBeVisible();
});

test("DDL checkbox：off → on → DDL fields visible；再次 off → fields hidden", async ({ page }) => {
  const dialog = await openAssignmentModal(page);
  const ddlLabel = dialog.locator('label:has(input[aria-label="设置截止时间"])');
  await ddlLabel.click();
  await expect(dialog.locator('input[type="date"]')).toBeVisible();
  await ddlLabel.click();
  await expect(dialog.locator('input[type="date"]')).toHaveCount(0);
});
