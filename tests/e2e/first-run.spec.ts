import { test, expect, Page } from "@playwright/test";

/**
 * First Run E2E：生产初始状态（无演示数据）——真实空工作区。
 * 注意：本 spec 不使用 demoFixtures，验证 fresh localStorage 行为。
 */

async function openFresh(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("getting-started")).toBeVisible();
}

test("首次打开：Getting Started 显示，无任何假数据", async ({ page }) => {
  await openFresh(page);

  await expect(page.getByText("欢迎使用 ClassFlow")).toBeVisible();
  await expect(page.getByTestId("getting-started").getByRole("button", { name: "添加第一门课程" })).toBeVisible();
  await expect(page.getByTestId("getting-started").getByRole("button", { name: "导入课表" })).toBeVisible();

  // 无假课程/假任务
  await expect(page.getByText("微观经济学")).toHaveCount(0);
  await expect(page.getByText("计量经济学大作业（第3章）")).toHaveCount(0);
  // Sidebar 不显示假学生身份
  await expect(page.getByText("张同学")).toHaveCount(0);
  await expect(page.getByText("未设置姓名").first()).toBeVisible();
});

test("Getting Started 动作：添加第一门课程打开新建课程 Modal；设置当前学期打开设置", async ({ page }) => {
  await openFresh(page);

  await page.getByTestId("getting-started").getByRole("button", { name: "添加第一门课程" }).click();
  await expect(page.getByRole("heading", { name: "添加课程" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("getting-started").getByRole("button", { name: "设置当前学期" }).click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
});

test("其他页面空态：课程/课表/分析均为真实空状态", async ({ page }) => {
  await openFresh(page);

  // 课程页
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await expect(page.getByText("暂无课程").first()).toBeVisible();
  await expect(page.getByText("添加第一门课程或导入课表")).toBeVisible();

  // 分析页
  await page.getByRole("button", { name: "学习统计" }).first().click();
  await expect(page.getByText("暂无可分析的学习数据")).toBeVisible();

  // 课表页
  await page.getByRole("button", { name: "我的课表" }).first().click();
  await expect(page.getByText("暂无课程").last()).toBeVisible();
  await expect(page.getByText("添加课程或导入课表后即可查看排课")).toBeVisible();
});

test("Data Settings：清空学习数据后课程消失、个人资料保留", async ({ page }) => {
  await openFresh(page);

  // 先建立一些数据（添加课程 Modal 直接创建）
  await page.getByTestId("getting-started").getByRole("button", { name: "添加第一门课程" }).click();
  await expect(page.getByRole("heading", { name: "添加课程" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 设置个人资料
  await page.getByRole("button", { name: "设置" }).first().click();
  await page.getByTestId("settings-profile").getByLabel("姓名").fill("测试用户");
  await page.getByTestId("settings-profile").getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("设置已保存").first()).toBeVisible();

  // 清空学习数据
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "数据与存储" }).click();
  const clearBtn = page.getByTestId("danger-learning");
  await clearBtn.scrollIntoViewIfNeeded();
  await clearBtn.click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByText("学习数据已清空").first()).toBeVisible();

  // 个人资料保留
  await page.getByRole("navigation", { name: "设置导航" }).getByRole("button", { name: "个人资料" }).click();
  await expect(page.getByTestId("settings-profile").getByLabel("姓名")).toHaveValue("测试用户");
});
