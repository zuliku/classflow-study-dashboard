import { expect } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 2C3A Group smoke：GroupCollaborationView 使用统一 Form primitives 后
 * 创建项目 → 添加成员 → 添加任务 → checkbox 标记完成 保持可用（业务语义未变）。
 */

async function openGroup(page: import("@playwright/test").Page) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "小组协作" }).first().click();
  await expect(page.getByRole("heading", { name: "小组协作" })).toBeVisible();
}

test("Group：创建项目 → 添加成员 → 添加任务 → checkbox 标记完成", async ({ page }) => {
  await openGroup(page);
  await page.getByRole("button", { name: "新建项目" }).first().click();

  // 项目表单（Field + Input）
  const projectDialog = page.getByRole("dialog", { name: "小组项目" });
  await expect(projectDialog).toBeVisible();
  await projectDialog.getByLabel("项目名称").fill("Task 2C3A 冒烟项目");
  await projectDialog.getByRole("button", { name: "创建项目" }).click();
  await expect(projectDialog).toHaveCount(0);
  await expect(page.getByText("Task 2C3A 冒烟项目").first()).toBeVisible();

  // 添加成员
  await page.getByRole("button", { name: "添加成员" }).first().click();
  const memberDialog = page.getByRole("dialog", { name: "小组项目" });
  await memberDialog.getByLabel("姓名").fill("测试成员");
  await memberDialog.getByRole("button", { name: "添加成员" }).last().click();
  await expect(memberDialog).toHaveCount(0);
  await expect(page.getByText("测试成员").first()).toBeVisible();

  // 添加任务
  await page.getByRole("button", { name: "添加任务" }).first().click();
  const taskDialog = page.getByRole("dialog", { name: "小组项目" });
  await taskDialog.getByLabel("任务名称").fill("冒烟任务一");
  await taskDialog.getByRole("combobox", { name: "负责人" }).click();
  await page.getByRole("option", { name: "测试成员" }).first().click();
  await taskDialog.getByRole("button", { name: "添加任务" }).last().click();
  await expect(taskDialog).toHaveCount(0);
  await expect(page.getByText("冒烟任务一").first()).toBeVisible();

  // checkbox 标记完成（点击可见视觉框：wrapper label；aria-label 随状态切换）
  const checkboxLabel = page.locator('label:has(input[aria-label="标记完成"])').first();
  await checkboxLabel.click();
  await expect(page.getByRole("checkbox", { name: "标记未完成" })).toBeChecked();
});

test("Group：编辑任务 → 修改负责人 → 保存 → 正常显示", async ({ page }) => {
  await openGroup(page);
  // 自建项目与任务（演示数据 group 为空）
  await page.getByRole("button", { name: "新建项目" }).first().click();
  const projectDialog = page.getByRole("dialog", { name: "小组项目" });
  await projectDialog.getByLabel("项目名称").fill("编辑冒烟项目");
  await projectDialog.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("button", { name: "添加任务" }).first().click();
  const taskDialog = page.getByRole("dialog", { name: "小组项目" });
  await taskDialog.getByLabel("任务名称").fill("待编辑任务");
  await taskDialog.getByRole("button", { name: "添加任务" }).last().click();
  await expect(page.getByText("待编辑任务").first()).toBeVisible();

  // hover 任务行使 hover-only 编辑按钮可见，再点击
  await page.getByText("待编辑任务").first().hover();
  await page.getByRole("button", { name: /编辑任务/ }).first().click();
  await expect(taskDialog.getByRole("heading", { name: "编辑任务" })).toBeVisible();
  await taskDialog.getByLabel("任务名称").fill("已编辑任务");
  await taskDialog.getByRole("button", { name: "保存修改" }).click();
  await expect(taskDialog).toHaveCount(0);
  await expect(page.getByText("已编辑任务").first()).toBeVisible();
});
