import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * App Chrome V2 — Collapsible Sidebar / Profile Card / Workspace View Bar / Command Center E2E：
 * 1) Sidebar：≥1280 折叠/展开 + 持久化；768–1279 强制 rail；tooltip；Active Plate 正常
 * 2) Profile Card：展开信息完整 + 点击 → 设置个人资料；折叠仅头像；0 学分降级
 * 3) Task View Bar：视图/counts/筛选/搜索/归档 迁移后语义不变
 * 4) Command Center：导航与 Sidebar 同一文案；视图命令原子切换；打开提醒/设置
 * 5) Mobile：Bottom Nav 不变，无桌面侧栏回归
 */

async function openSettings(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
}

// ==================== 1. Sidebar 折叠 / 展开 / 持久化 ====================

test("Sidebar ≥1280：展开 → 收起 → 展开；宽度 224/64，标签与 tooltip 切换", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const sidebar = page.getByTestId("app-sidebar");

  // 默认展开（w-56 = 224px）
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  const expandedBox = await sidebar.boundingBox();
  expect(expandedBox!.width).toBeCloseTo(224, 0);
  await expect(page.getByTestId("nav-label").first()).toBeVisible();

  // 收起 → 64px，标签隐藏，tooltip 出现（等待 morph 完成后的最终几何）
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await expect.poll(async () => (await sidebar.boundingBox())!.width, { timeout: 5000 }).toBeLessThan(65);
  await expect(page.getByTestId("nav-label").first()).toBeHidden();
  await expect(page.getByTestId("nav-tooltip").first()).toBeVisible();

  // 导航仍可用（Active Plate 正常）：点击「总览」
  await sidebar.getByRole("button", { name: "总览" }).click();
  await expect(page.getByTestId("nav-active-plate")).toHaveClass(/opacity-100/);

  // 再展开 → 恢复
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(sidebar).toHaveAttribute("data-collapsed", "false");
  await expect.poll(async () => (await sidebar.boundingBox())!.width, { timeout: 5000 }).toBeGreaterThan(220);
  await expect(page.getByTestId("nav-label").first()).toBeVisible();
});

test("Sidebar ≥1280：手动折叠状态刷新后保持（持久化）", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("sidebar-collapse-toggle").click();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");

  await page.reload();
  await expect(page.getByTestId("app-sidebar")).toHaveAttribute("data-collapsed", "true");
  await expect(page.getByTestId("nav-label").first()).toBeHidden();
});

test("Sidebar 768–1279：强制 icon rail（无展开泄漏，无折叠按钮）", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  const sidebar = page.getByTestId("app-sidebar");
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  const box = await sidebar.boundingBox();
  expect(box!.width).toBeCloseTo(64, 0);
  // 无用户折叠控件（强制 rail）
  await expect(page.getByTestId("sidebar-collapse-toggle")).toHaveCount(0);
  // tooltip 可见（rail 语义）
  await expect(page.getByTestId("nav-tooltip").first()).toBeVisible();
});

// ==================== 2. Profile Card ====================

test("Profile Card：展开显示姓名/学院/学分进度；点击 → 设置个人资料", async ({ page }) => {
  await openSettings(page);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  const card = page.getByRole("button", { name: "打开个人资料" });
  await expect(card).toBeVisible();
  await expect(card.getByText("张同学", { exact: true })).toBeVisible();
  await expect(card.getByText("经济与管理学院")).toBeVisible();
  await expect(card.getByText("本学期学分进度")).toBeVisible();
  await expect(card.getByText(/64 \/ 80 学分/)).toBeVisible();

  // 整卡可点击 → Settings → profile section（settingsTargetSection 机制）
  await card.click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page.getByTestId("settings-profile")).toBeVisible();
});

test("Profile Card：折叠态仅头像，tooltip 含姓名；点击行为一致", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("sidebar-collapse-toggle").click();

  // single-DOM morph：同一按钮，collapsed 下只呈现头像 + tooltip（含姓名）
  const avatarEntry = page.getByRole("button", { name: "打开个人资料" });
  await expect(avatarEntry).toBeVisible();
  await avatarEntry.hover();
  await expect(avatarEntry.getByRole("tooltip")).toBeVisible();
  await expect(avatarEntry.getByRole("tooltip")).toContainText("张同学");

  await avatarEntry.click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
  await expect(page.getByTestId("settings-profile")).toBeVisible();
});

test("Profile Card：totalCredits = 0 → 不显示 0/0 进度，降级「完善学业信息」", async ({ page }) => {
  await page.addInitScript(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.state?.userProfile) {
        parsed.state.userProfile.completedCredits = 0;
        parsed.state.userProfile.totalCredits = 0;
        localStorage.setItem("classflow-storage-v2", JSON.stringify(parsed));
      }
    }
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const card = page.getByRole("button", { name: "打开个人资料" });
  await expect(card).toBeVisible();
  await expect(card.getByText("完善学业信息")).toBeVisible();
  await expect(card.getByText(/0 \/ 0 学分/)).toHaveCount(0);
});

// ==================== 3. Task View Bar ====================

test("Task View Bar：主视图 + counts + 课程筛选 + 搜索 + 归档迁移后可用", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();

  const bar = page.getByTestId("assignment-viewbar");
  await expect(bar).toBeVisible();

  // 主视图 + counts
  for (const name of [/^聚焦 \d+$/, /^今天 \d+$/, /^即将截止 \d+$/, /^待安排 \d+$/, /^全部 \d+$/]) {
    await expect(bar.getByRole("button", { name })).toBeVisible();
  }
  // 默认聚焦：列表有内容
  await expect(page.getByTestId("assignment-list")).toBeVisible();

  // 课程筛选 → 列表变化
  await bar.getByRole("combobox", { name: "课程筛选" }).click();
  await page.getByRole("listbox", { name: "课程筛选" }).getByRole("option", { name: "数据分析" }).click();
  await expect(page.getByRole("combobox", { name: "课程筛选" })).toContainText("数据分析");

  // 搜索
  await page.getByLabel("搜索任务").fill("计量经济学");
  await expect(page.getByTestId("assignment-list").getByText("计量经济学大作业（第3章）")).toBeVisible();
  await page.getByLabel("搜索任务").fill("");

  // 全部视图 → More → 已归档（先重置课程筛选，避免残留过滤）
  await bar.getByRole("combobox", { name: "课程筛选" }).click();
  await page.getByRole("listbox", { name: "课程筛选" }).getByRole("option", { name: /全部课程/ }).click();
  await bar.getByRole("button", { name: /^全部 \d+$/ }).click();
  await page.getByRole("button", { name: "更多视图" }).click();
  await page.getByRole("button", { name: /查看已归档/ }).click();
  await expect(bar.getByText("已归档")).toBeVisible();
  await expect(page.getByTestId("assignment-list").getByText("高等数学级数与重积分测试")).toBeVisible();
});

test("Task View Bar：Quick Add 仍由 Header 驱动；键盘导航保留", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();

  // Quick Add（Header 主按钮）
  await page
    .getByTestId("assignments-tab")
    .getByRole("button", { name: /新增任务|收起/ })
    .click();
  await expect(page.getByTestId("quick-add-card")).toBeVisible();
  await page
    .getByTestId("assignments-tab")
    .getByRole("button", { name: /新增任务|收起/ })
    .click();
  await expect(page.getByTestId("quick-add-card")).toHaveCount(0);

  // 键盘：J 移动 highlight（行级 ring 高亮）
  const list = page.getByTestId("assignment-list");
  await list.focus();
  await page.keyboard.press("j");
  const highlighted = await page
    .locator('[data-testid="assignment-list"] [data-assignment-id].ring-line-strong')
    .first()
    .getAttribute("data-assignment-id");
  expect(highlighted).toBeTruthy();
});

// ==================== 4. Command Center ====================

test("Command Center：导航命令与 Sidebar 文案一致；视图命令原子切换", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.keyboard.press("Control+k");
  const results = page.getByTestId("command-results");
  // Sidebar 同源文案
  for (const label of ["前往总览", "前往时间表", "前往任务与 DDL", "前往课程资料", "前往学习洞察", "前往小组协作", "前往Kiro"]) {
    await expect(results.getByText(label)).toBeVisible();
  }
  await page.keyboard.press("Escape");

  // 视图命令：任务与 DDL → 今天（原子：切工作区 + 视图；「今天」唯一命中视图命令）
  await page.keyboard.press("Control+k");
  await page.keyboard.type("今天");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
  const todayTab = page
    .getByTestId("assignments-tab")
    .getByRole("button", { name: /^今天 \d+$/ });
  await expect(todayTab).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("command-center")).toHaveCount(0);
});

test("Command Center：打开提醒 / 打开设置 全局动作可用", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");

  await page.keyboard.press("Control+k");
  await page.keyboard.type("打开提醒");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("reminder-center")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("reminder-center")).toHaveCount(0);

  await page.keyboard.press("Control+k");
  await page.keyboard.type("打开设置");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("settings-view")).toBeVisible();
});

// ==================== 5. Mobile ====================

test("Mobile：Bottom Nav 不变，桌面侧栏隐藏，无回归", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("app-sidebar")).toBeHidden();
  const bottomNav = page.getByRole("navigation", { name: "底部导航" });
  await expect(bottomNav).toBeVisible();
  for (const label of ["总览", "时间表", "任务", "Kiro", "更多"]) {
    await expect(bottomNav.getByRole("button", { name: label })).toBeVisible();
  }
  // 更多 → 设置仍可打开
  await bottomNav.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible();
});
