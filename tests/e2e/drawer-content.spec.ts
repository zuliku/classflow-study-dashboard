import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 2C2 Drawer 内容 smoke：AssignmentDrawer / CourseDetailDrawer 使用统一 primitives 后
 * 高频交互保持可用（业务语义未变）。
 */

test("AssignmentDrawer：status/priority 切换 + subtask checkbox + 编辑入口 + Esc 关闭", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  // 从任务工作区打开 Assignment Drawer（Overview 标题存在既有点击不稳定问题）
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
  await page.getByTestId("assignment-list").getByText("计量经济学大作业（第3章）").click();
  const drawer = page.getByRole("dialog", { name: "任务详情" });
  await expect(drawer).toBeVisible();

  // status / priority 为 compact UISelect，可切换
  await drawer.getByRole("combobox", { name: "任务状态" }).click();
  await page.getByRole("option", { name: "进行中" }).first().click();
  await drawer.getByRole("combobox", { name: "优先级" }).click();
  await page.getByRole("option", { name: "高" }).first().click();

  // subtask checkbox：点击第一项 → 状态翻转；再点击 → 复原
  const subtaskCheckbox = drawer.getByRole("checkbox").first();
  const before = await subtaskCheckbox.isChecked();
  await drawer.locator("label:has(input[type=checkbox])").first().click();
  await expect(subtaskCheckbox).toBeChecked({ checked: !before });
  await drawer.locator("label:has(input[type=checkbox])").first().click();
  await expect(subtaskCheckbox).toBeChecked({ checked: before });

  // 编辑入口 → Assignment Editor（CustomEvent）
  await drawer.getByRole("button", { name: "编辑" }).click();
  const editor = page.getByRole("dialog", { name: "添加任务" });
  await expect(editor).toBeVisible();
  await expect(editor.getByRole("heading", { name: "编辑任务" })).toBeVisible();
  await editor.getByRole("button", { name: "关闭" }).click();

  // 主操作 标记完成 → 状态变为已完成（首屏 Primary Actions；关闭走关闭按钮）
  await drawer.getByRole("button", { name: "标记完成" }).click();
  await expect(drawer.getByRole("button", { name: "重新打开" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭" }).click();
  await expect(drawer).toHaveCount(0);
});

test("CourseDetailDrawer：编辑态修改字段 + 保存 → 回 view mode 数据正确", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("heading", { name: "微观经济学" }).first().click();
  const drawer = page.getByRole("dialog", { name: "课程详情" });
  await expect(drawer).toBeVisible();
  // Floating Course Hub：non-blocking contextual panel，不声明 aria-modal
  await expect(drawer).not.toHaveAttribute("aria-modal", "true");

  // 进入编辑态 → 修改教师 → 保存（Header [取消] [保存]）
  await drawer.getByRole("button", { name: "编辑课程信息" }).click();
  const teacherInput = drawer.getByPlaceholder("授课教师");
  await teacherInput.fill("测试新老师");
  await drawer.getByRole("button", { name: "保存", exact: true }).click();

  // 回 view mode：教师数据已更新
  await expect(drawer.getByText("测试新老师")).toBeVisible();

  // Esc 关闭 Drawer
  await drawer.getByRole("button", { name: "关闭" }).click();
  await expect(drawer).toHaveCount(0);
});
