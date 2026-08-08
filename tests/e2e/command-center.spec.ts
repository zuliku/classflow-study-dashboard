import { test, expect, Page } from "@playwright/test";

/**
 * Command Center E2E：Cmd/Ctrl+K 关闭态打开、导航、实体搜索、N 创建、输入守卫。
 */

async function openPalette(page: Page) {
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-center")).toBeVisible();
}

test("Global open：完全关闭状态 Cmd+K 打开 / Esc 关闭 / 再次打开", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByTestId("command-center")).toHaveCount(0);

  // 关闭态（弹层从未挂载）快捷键依然生效
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-center")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "命令中心搜索" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center")).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-center")).toBeVisible();
});

test("导航：Cmd+K 输入「课表」Enter → activeTab 切换为课表", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openPalette(page);

  await page.keyboard.type("课表");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "学期课表" })).toBeVisible();
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});

test("实体搜索：输入「高等数学」Enter → 打开课程 Drawer", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openPalette(page);

  await page.keyboard.type("高等数学");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "高等数学" }).last()).toBeVisible();
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});

test("创建：无输入焦点按 N → 打开新建任务弹窗", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "新建任务" })).toHaveCount(0);
});

test("输入守卫：输入框聚焦时 N / ? / / 不触发全局命令", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openPalette(page);

  // 输入框已聚焦：按 N 只是输入字符，不弹新建任务
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "新建任务" })).toHaveCount(0);
  // 按 ? 只是输入字符，不打开快捷键指南
  await page.keyboard.type("?");
  await expect(page.getByText("键盘快捷键")).toHaveCount(0);
  // 输入框内容应为 "n?"
  await expect(page.getByRole("textbox", { name: "命令中心搜索" })).toHaveValue("n?");

  // Esc 关闭后（等退出动画结束、焦点归位），? 才真正打开指南
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  await page.keyboard.press("?");
  await expect(page.getByText("键盘快捷键")).toBeVisible();
  await expect(page.getByText("打开命令中心")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});

test("空查询可浏览：打开即显示快速操作与导航分组", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await openPalette(page);

  await expect(page.getByTestId("command-results").getByText("新建任务")).toBeVisible();
  await expect(page.getByTestId("command-results").getByText("前往课表")).toBeVisible();
  await expect(page.getByTestId("command-results").getByText("前往设置")).toBeVisible();
  // 快捷键提示可见（桌面）
  await expect(page.getByTestId("command-results").getByText("N")).toBeVisible();
  // 未选中任何实体：不显示「上下文操作」标题
  await expect(page.getByText("上下文操作")).toHaveCount(0);
});

test("Course Context：选中课程后显示上下文命令，新建任务带入课程", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 课程 Tab 打开「微观经济学」Course Drawer → selectedCourseId 生效
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.locator('div[role="button"]').filter({ hasText: "微观经济学" }).first().click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();

  await openPalette(page);
  await expect(page.getByText("上下文操作")).toBeVisible();
  const results = page.getByTestId("command-results");
  await expect(results.getByText("为《微观经济学》新建任务")).toBeVisible();

  // Enter 执行第一项（上下文命令优先）
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await expect(page.getByTestId("command-center")).toHaveCount(0);

  // Esc 只关闭 Assignment Editor（overlay 一致性：Command Center 不残留/不重开）
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "新建任务" })).toHaveCount(0);
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});

test("Assignment Context：选中任务后显示编辑命令，打开的是编辑模式", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 打开「计量经济学大作业」Assignment Drawer → selectedAssignmentId 生效
  await page.getByText("计量经济学大作业（第3章）").first().click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();

  await openPalette(page);
  await expect(page.getByText("上下文操作")).toBeVisible();
  await expect(
    page.getByTestId("command-results").getByText("编辑「计量经济学大作业（第3章）」")
  ).toBeVisible();

  await page.keyboard.press("Enter");
  // 编辑模式（heading 为「编辑任务」而非「新建任务」）→ 打开的是正确 assignment
  await expect(page.getByRole("heading", { name: "编辑任务" })).toBeVisible();
  await expect(page.getByTestId("command-center")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "编辑任务" })).toHaveCount(0);
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});

test("事件统一：palette「新建任务」与 N 走同一入口（都打开新建任务编辑器）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  // 路径一：N
  await page.keyboard.press("n");
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await page.keyboard.press("Escape");

  // 路径二：palette 搜索「新建」→ Enter
  await openPalette(page);
  await page.keyboard.type("新建");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await expect(page.getByTestId("command-center")).toHaveCount(0);
  await page.keyboard.press("Escape");
});
