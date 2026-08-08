import { test, expect, Page } from "@playwright/test";

/**
 * MiniCalendar 当日日程 Compact Event Grid E2E：
 * 一行 4 列、仅类型+图标、点击开 Drawer、>4 分页（标题行右侧）、日期切换回第 1 页、高度恒定。
 */

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function dPlus(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmt(d);
}

/** 注入一条与 target 同日的新 DDL（a9）构造 5 项日程触发分页：
 * 1) 先触发一次 store mutation 让 zustand persist 把 demo 数据写入 localStorage；
 * 2) 读回 localStorage 追加 a9；3) reload 后 hydrate 合并。 */
async function injectExtraDDL(page: Page, targetDate: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
  // 触发 persist 写入（assignmentTimeSlice 是持久化白名单字段）
  await page.getByTestId("overview-tasks-wrap").getByRole("button", { name: "已逾期" }).click();
  await page.waitForTimeout(300);

  const extra = {
    id: "a9",
    courseId: "c2",
    title: "分页注入测试任务",
    description: "",
    ddl: `${targetDate}T21:00:00`,
    priority: "medium",
    status: "todo",
    progress: 0,
    tags: [],
  };
  await page.evaluate((assignment) => {
    const key = "classflow-storage-v2";
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const state = parsed?.state ?? parsed;
    if (!state || !Array.isArray(state.assignments)) return;
    state.assignments = [...state.assignments, assignment];
    localStorage.setItem(key, JSON.stringify({ state, version: 2 }));
  }, extra);

  await page.reload();
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
}

async function openOverview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("[data-calendar-day]").first()).toBeVisible();
}

async function selectDate(page: Page, dateStr: string) {
  await page.locator(`[data-calendar-day="${dateStr}"]`).click();
}

test("4 项日程：一行 4 列、无分页器、只显示类型标签（无标题/时间）", async ({ page }) => {
  await openOverview(page);
  // 周一（今天+2 天附近需命中 s1/s2/s3 三节课 + a2 DDL 的同一天）
  // 稳定构造：选中今天+2 的日期（a2 DDL 所在日），若该天课程不足则选今天（有课程无 DDL）
  // 用周日（+7 内的 demo 数据）：直接选「今天」——周六有 s12 管理学原理？
  // 更稳：选周一 8/10（+2 天）→ s1/s2/s3 三节 + a2 DDL = 4 项
  const target = dPlus(2);
  await selectDate(page, target);

  const grid = page.getByTestId("agenda-grid");
  await expect(grid).toBeVisible();
  // 4 个 cell：课程×3 + DDL×1
  await expect(grid.locator("button")).toHaveCount(4);
  await expect(grid.locator("button")).toHaveCount(4);
  // cell 只显示类型标签
  await expect(grid.getByText("课程", { exact: true })).toHaveCount(3);
  await expect(grid.getByText("DDL", { exact: true })).toHaveCount(1);
  // 不显示标题/时间详情
  await expect(grid.getByText("计量经济学大作业（第3章）")).toHaveCount(0);
  await expect(grid.getByText(/08:00|09:40/)).toHaveCount(0);
  // 无分页器
  await expect(grid.getByRole("button", { name: "下一页" })).toHaveCount(0);
});

test("点击 cell 打开详情 Drawer：DDL → AssignmentDrawer；课程 → CourseDrawer（不在卡片内展开）", async ({ page }) => {
  await openOverview(page);
  const target = dPlus(2);
  await selectDate(page, target);

  // DDL cell → Assignment Drawer
  await page.locator('[data-testid="agenda-ddl-item"][data-agenda-assignment="a2"]').click();
  await expect(page.getByRole("heading", { name: "市场营销案例汇报" }).last()).toBeVisible();
  await expect(page.getByTestId("agenda-grid").getByText("DDL", { exact: true })).toHaveCount(1); // grid 仍在，未内联展开
  await page.getByRole("button", { name: "关闭" }).first().click();

  // 课程 cell → Course Drawer
  await page.getByTestId("agenda-grid").getByText("课程", { exact: true }).first().click();
  await expect(page.getByRole("button", { name: "关闭" }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "微观经济学" }).last()).toBeVisible();
});

test("日程区域高度恒定：4 项与 1 项日期切换时高度不变；0 项显示空态且同高", async ({ page }) => {
  await openOverview(page);
  await selectDate(page, dPlus(2)); // 4 项（3 课 + 1 DDL）
  const gridBox4 = await page.getByTestId("agenda-grid").boundingBox();

  // 切到 1 项日期（今天+1：a1 DDL，无课程）
  await selectDate(page, dPlus(1));
  await expect(page.getByTestId("agenda-grid").locator("button")).toHaveCount(1);
  const gridBox1 = await page.getByTestId("agenda-grid").boundingBox();
  expect(Math.abs(gridBox1!.height - gridBox4!.height)).toBeLessThanOrEqual(1);

  // 0 项：切到下月周日（无课程无 DDL）→ 空态且区域同高
  await page.getByRole("button", { name: "下一月" }).click();
  await selectDate(page, "2026-09-13");
  await expect(page.getByText("暂无安排")).toBeVisible();
  const gridBox0 = await page.getByTestId("agenda-grid").boundingBox();
  expect(Math.abs(gridBox0!.height - gridBox4!.height)).toBeLessThanOrEqual(1);

  // 卡片整体高度也稳定
  const cardBox4 = await page.getByTestId("calendar-card").boundingBox();
  const cardBox0 = await page.getByTestId("calendar-card").boundingBox();
  expect(Math.abs(cardBox0!.height - cardBox4!.height)).toBeLessThanOrEqual(1);
});

test(">4 项：分页器在标题行右侧，下一页显示剩余项，切换日期自动回第 1 页", async ({ page }) => {
  const target = dPlus(2); // 周一：3 课 + a2 DDL + 注入 a9 = 5 项
  await injectExtraDDL(page, target);

  await selectDate(page, target);
  const grid = page.getByTestId("agenda-grid");
  const calCard = page.getByTestId("calendar-card");
  // 5 项 → 第一页 4 项 + 分页 1 / 2（标题行右侧）
  await expect(grid.locator("button")).toHaveCount(4);
  await expect(calCard.getByText("1 / 2", { exact: true })).toBeVisible();

  // 下一页 → 剩余 1 项
  await calCard.getByRole("button", { name: "下一页" }).click();
  await expect(calCard.getByText("2 / 2", { exact: true })).toBeVisible();
  await expect(grid.locator("button")).toHaveCount(1);
  await expect(calCard.getByRole("button", { name: "下一页" })).toBeDisabled();

  // 切换日期 → 自动回第 1 页
  await selectDate(page, dPlus(3));
  await selectDate(page, target);
  await expect(calCard.getByText("1 / 2", { exact: true })).toBeVisible();
  await expect(grid.locator("button")).toHaveCount(4);
});
