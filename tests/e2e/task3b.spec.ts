import { expect, Page } from "@playwright/test";
import { test } from "./demoFixtures";

/**
 * Task 3B：Quick Add V2 / Drawer V2（Deadline Health + StudyBlock）/ At Risk Tab / Kiro 品牌按钮。
 */

async function openWorkspace(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "任务工作区" }).first().click();
  await expect(page.getByRole("heading", { name: "任务与 DDL" })).toBeVisible();
}

test("Ask Kiro 使用正式品牌按钮（KiroFlowButton）", async ({ page }) => {
  await openWorkspace(page);
  const btn = page.getByRole("button", { name: "Ask Kiro" });
  await expect(btn).toBeVisible();
  // KiroFlowButton：内层浅色底 + kiro-ring 流光环
  await expect(btn.locator(".kiro-ring").first()).toBeVisible();
  await expect(btn.locator(".kiro-featured-flow").first()).toBeVisible();
  // 不再有 Sparkles
  await expect(btn.locator("svg.lucide-sparkles")).toHaveCount(0);
});

test("Quick Add：只填标题即可创建，默认无 DDL，不产生 CalendarMark", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "新增任务" }).click();
  const card = page.getByTestId("quick-add-card");
  await expect(card).toBeVisible();
  await card.getByPlaceholder("要完成什么？").fill("快速捕获任务");
  await card.getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("任务已创建").first()).toBeVisible();

  // 行出现且显示「无截止日期」（Task V2：默认无 DDL）
  await page.getByRole("button", { name: /^全部 \d+$/ }).click();
  await expect(page.locator('[data-assignment-id]').filter({ hasText: "快速捕获任务" })).toBeVisible();
  await expect(page.locator('[data-assignment-id]').filter({ hasText: "快速捕获任务" })).toContainText("无截止日期");

  // 不产生 CalendarMark
  const markCount = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return -1;
    const s = JSON.parse(raw).state ?? {};
    const a = (s.assignments ?? []).find((x: any) => x.title === "快速捕获任务");
    if (!a) return -2;
    return (s.calendarMarks ?? []).filter((m: any) => m.sourceId === a.id).length;
  });
  expect(markCount).toBe(0);
});

test("Quick Add：展开更多可设优先级/预计耗时；更多详情打开 Full Editor", async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole("button", { name: "新增任务" }).click();
  const card = page.getByTestId("quick-add-card");
  await card.getByPlaceholder("要完成什么？").fill("带预估任务");
  await card.getByRole("button", { name: "更多", exact: true }).click();
  await card.getByLabel("预计耗时（分钟）").fill("45");
  await card.getByRole("button", { name: "创建" }).click();
  await expect(page.getByText("任务已创建").first()).toBeVisible();
  await page.getByRole("button", { name: /^全部 \d+$/ }).click();
  await expect(page.locator('[data-assignment-id]').filter({ hasText: "带预估任务" })).toContainText("预计 45 分钟");

  // 更多详情 → Full Editor（卡片保持打开支持连续添加）
  await page.getByTestId("quick-add-card").getByRole("button", { name: /更多详情/ }).click();
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
});

test("Drawer V2：Deadline Health + 学习安排 + 未估时/未设置截止", async ({ page }) => {
  await openWorkspace(page);
  // a2（无 DDL）行打开 Drawer
  await page.locator('[data-assignment-id="a2"]').click();
  await expect(page.getByRole("heading", { name: "市场营销案例汇报" }).last()).toBeVisible();
  // Health 行（演示数据 → 有 DDL+estimate，未安排 → 尚未安排 或 信息不足）
  await expect(page.getByText(/尚未安排|信息不足|可能来不及|需要关注|计划充足/).first()).toBeVisible();
  // 学习安排 section 存在
  await expect(page.getByText("学习安排")).toBeVisible();
  // 预计耗时 / 未估时
  await expect(page.getByText("预计耗时", { exact: true })).toBeVisible();
  await expect(page.getByText("未估时")).toBeVisible();
  // 关闭
  await page.getByRole("button", { name: "关闭" }).first().click();
});

test("Part B：Primary 仅 5 个 Tab；有风险不再是永久 Tab；已归档经 More 进入", async ({ page }) => {
  await openWorkspace(page);
  for (const name of [/^聚焦 \d+$/, /^今天 \d+$/, /^即将截止 \d+$/, /^待安排 \d+$/, /^全部 \d+$/]) {
    await expect(page.getByRole("button", { name })).toBeVisible();
  }
  // 有风险不再占用一级 Tab（Domain 能力保留：Focus 内 Risk Filter / Kiro scope）
  await expect(page.getByRole("button", { name: /^有风险 \d+$/ })).toHaveCount(0);
  // 已归档经「···」More 菜单进入
  await page.getByRole("button", { name: "更多视图" }).click();
  await expect(page.getByRole("button", { name: /查看已归档/ })).toBeVisible();
});

test("Task 6B-B：Task Drawer 上传 → 自动关联 + Course 侧同一文件 + 刷新持久 + 解除关联不删文件", async ({ page }) => {
  await openWorkspace(page);
  // a2（c_5 市场营销案例汇报）初始无关联
  await page.locator('[data-assignment-id="a2"]').click();
  await expect(page.getByText("关联资料")).toBeVisible();

  // 添加资料 ▾ → 上传文件（hidden input，multiple）
  await page.getByRole("button", { name: /添加资料/ }).click();
  await page.getByRole("button", { name: "上传文件" }).click();
  await page.locator('input[type="file"]').last().setInputFiles({
    name: "营销案例数据.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 test"),
  });

  // Drawer 立即显示关联文件
  await expect(page.getByText("营销案例数据.pdf")).toBeVisible();
  await expect(page.getByText("已添加 1 份任务资料").first()).toBeVisible();

  // 同一文件在 Course（c_5）侧也存在（唯一 Source of Truth）
  const inCourse = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return false;
    const s = JSON.parse(raw).state ?? {};
    const c5 = (s.courses ?? []).find((c: any) => c.id === "c_5");
    return (c5?.materials ?? []).some((m: any) => m.title === "营销案例数据.pdf");
  });
  expect(inCourse).toBe(true);

  // 刷新后仍存在（persist）
  await page.reload();
  await page.getByRole("button", { name: "任务工作区" }).first().click();
  await page.locator('[data-assignment-id="a2"]').click();
  await expect(page.getByText("营销案例数据.pdf")).toBeVisible();

  // 解除关联：Task 侧消失，Course 中仍在
  await page.getByRole("button", { name: "解除关联 营销案例数据.pdf" }).click();
  await expect(page.getByText("营销案例数据.pdf")).toHaveCount(0);
  const stillInCourse = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return false;
    const s = JSON.parse(raw).state ?? {};
    const c5 = (s.courses ?? []).find((c: any) => c.id === "c_5");
    return (c5?.materials ?? []).some((m: any) => m.title === "营销案例数据.pdf");
  });
  expect(stillInCourse).toBe(true);
});

test("Task 7F：新建每周重复任务 → 完成当前 → 自动生成下一周 occurrence", async ({ page }) => {
  await openWorkspace(page);

  // Quick Add → 更多详情打开 Full Editor（Full Editor 不继承 Quick Add 标题，需重填）
  await page.getByRole("button", { name: "新增任务" }).click();
  const card = page.getByTestId("quick-add-card");
  await card.getByPlaceholder("要完成什么？").fill("每周英语单词复习");
  await card.getByRole("button", { name: /更多详情/ }).click();
  await expect(page.getByRole("heading", { name: "新建任务" })).toBeVisible();
  await page.getByRole("textbox", { name: "如：计量经济学实证报告" }).fill("每周英语单词复习");

  // 启用 DDL（明天）+ 重复 = 每周（scope 到 Modal 面板内的日期输入）
  await page.getByLabel("设置截止时间").check();
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const tomorrow = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  await page.locator(".ux-modal-panel input[type=\"date\"]").fill(tomorrow);
  await page.getByLabel("重复").selectOption("weekly");
  await page.getByRole("button", { name: "保存" }).click();
  await expect(page.getByRole("heading", { name: "新建任务" })).toHaveCount(0);

  // 全部视图：打开当前 occurrence 的 Drawer → 状态设为「已完成」→ 自动生成下一周
  await page.getByRole("button", { name: /^全部 \d+$/ }).first().click();
  const rows = page.locator('[data-assignment-id]').filter({ hasText: "每周英语单词复习" });
  await expect(rows).toHaveCount(1);
  await rows.first().click();
  await expect(page.getByRole("heading", { name: "每周英语单词复习" }).last()).toBeVisible();
  await page.getByRole("combobox", { name: "任务状态" }).selectOption("completed");
  await page.getByRole("button", { name: "关闭", exact: true }).first().click();

  // 自动生成下一周 occurrence（同一标题，共 2 条）；原任务进入 archive 区（列表靠后）
  await expect(rows).toHaveCount(2);
  await expect(rows.last().locator('input[type="checkbox"]')).toBeChecked();
  await expect(rows.first()).toContainText("截止: ");
  // 新 occurrence 截止 = 下一周
  await expect(rows.first()).toContainText("每周");

  // 打开新 occurrence（active 区靠前）的 Drawer → 显示「重复 · 每周」
  await rows.first().click();
  await expect(page.getByRole("heading", { name: "每周英语单词复习" }).last()).toBeVisible();
  await expect(page.getByText("重复 · 每周")).toBeVisible();
});

test("Task 6A：Drawer 关联资料 - 显示/解除关联只改 Task、不删课程文件；Picker 可重新添加", async ({ page }) => {
  await openWorkspace(page);
  // a1（c_4 计量经济学大作业）演示数据关联 m5
  await page.locator('[data-assignment-id="a1"]').click();
  await expect(page.getByText("关联资料")).toBeVisible();
  await expect(page.getByText("Lab 3 Pandas 数据清洗与回归拟合代码.ipynb")).toBeVisible();

  // 解除关联：Task 侧消失，课程 Material 仍然存在
  await page.getByRole("button", { name: "解除关联 Lab 3 Pandas 数据清洗与回归拟合代码.ipynb" }).click();
  await expect(page.getByText("Lab 3 Pandas 数据清洗与回归拟合代码.ipynb")).toHaveCount(0);

  const stillExists = await page.evaluate(() => {
    const raw = localStorage.getItem("classflow-storage-v2");
    if (!raw) return false;
    const s = JSON.parse(raw).state ?? {};
    const c4 = (s.courses ?? []).find((c: any) => c.id === "c_4");
    return (c4?.materials ?? []).some((m: any) => m.id === "m5");
  });
  expect(stillExists).toBe(true);

  // Picker：添加资料 ▾ → 选择课程资料；显示课程内全部资料（含刚解除的），点击重新关联 → ✓ 出现
  await page.getByRole("button", { name: /添加资料/ }).click();
  await page.getByRole("button", { name: "选择课程资料" }).click();
  const picker = page.getByTestId("material-picker");
  await expect(picker).toBeVisible();
  await expect(picker.getByText("Lab 3 Pandas 数据清洗与回归拟合代码.ipynb")).toBeVisible();
  await picker.getByText("Lab 3 Pandas 数据清洗与回归拟合代码.ipynb").click();
  await expect(picker.locator("svg.lucide-check")).toHaveCount(1);
});
