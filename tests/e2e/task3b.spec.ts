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
