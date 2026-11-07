import { test, Page, expect } from "@playwright/test";

/**
 * 全模块示例数据可见性 E2E（示例数据改为设置内手动载入后）：
 * 总览 / 时间表 / 任务 / 课程资料 / 学习洞察 / 小组协作 各模块真实渲染。
 */
async function seedDemoData(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "设置" }).first().click();
  await expect(page.getByTestId("settings-view")).toBeVisible();
  await page
    .getByTestId("settings-view")
    .getByRole("button", { name: "数据与隐私", exact: true })
    .click();
  await page.getByTestId("data-diagnostics-toggle").click();
  await page.getByRole("button", { name: "载入示例数据", exact: true }).click();
  await page.getByTestId("confirm-dialog-confirm").click();
  await expect(page.getByText("示例数据已载入").first()).toBeVisible({ timeout: 10000 });

  // 本 spec 验证旧 Timeline 图层：切到经典时间表
  await page
    .getByTestId("settings-view")
    .getByRole("button", { name: "通用", exact: true })
    .click();
  await page
    .getByTestId("settings-general")
    .locator('[data-setting-id="timetable-mode"]')
    .getByRole("button", { name: "经典时间表" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("settings-view")).toHaveCount(0);
  // 示例数据 restore 后让 LearningHistoryRuntime 在干净启动中完成 focus backfill
  await page.reload();
  await page.waitForTimeout(800);
}

const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text as string).filter({ visible: true }).first();

test("全模块示例数据可见性：总览/时间表/任务/课程资料/统计/小组协作", async ({ page }) => {
  await seedDemoData(page);

  // ---- 总览 ----
  await expect(visibleText(page, /数据结构与算法/)).toBeVisible();
  await expect(visibleText(page, /页面置换算法模拟/)).toBeVisible();
  await expect(visibleText(page, /临近 DDL/)).toBeVisible();
  await expect(page.getByTestId("calendar-card")).toBeVisible();

  // ---- 时间表（经典模式）----
  await page.getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(600);
  await expect(page.getByTestId("timeline-workspace")).toBeVisible();
  expect(await page.locator('[data-testid="timeline-study-block"]').count()).toBeGreaterThan(0);

  // ---- 任务与 DDL ----
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /页面置换算法模拟/)).toBeVisible();
  await expect(visibleText(page, /贝叶斯决策线上小测/)).toBeVisible();
  await expect(visibleText(page, /子任务: 1 \/ 2/)).toBeVisible();

  // ---- 课程资料 + 材料（drawer）----
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /数据结构与算法/)).toBeVisible();
  await page.getByText("数据结构与算法").first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /第4章 图的遍历与最短路径\.pdf/)).toBeVisible();
  await expect(visibleText(page, /算法可视化（Visualgo）/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // ---- 学习洞察 ----
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await page.waitForTimeout(600);
  await expect(page.getByTestId("analytics-body")).toBeVisible();
  await expect(page.getByTestId("learning-trend-card")).toBeVisible();
  await expect(visibleText(page, /专注节奏/)).toBeVisible();
  await expect(visibleText(page, /课程投入/)).toBeVisible();
  await expect(visibleText(page, /学习洞察会随着使用逐渐形成/)).toHaveCount(0);

  // ---- 小组协作 ----
  await page.getByRole("button", { name: "小组协作" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /校园导航系统课程设计/)).toBeVisible();
  await expect(visibleText(page, /李晨/)).toBeVisible();
  await expect(visibleText(page, /Dijkstra 算法实现/)).toBeVisible();
});
