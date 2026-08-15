import { test, Page, expect } from "@playwright/test";

/**
 * 全模块预览数据可见性 E2E（开发自动注入后逐模块验证，V2 完整数据集）。
 * 所有断言用 visible filter：避免匹配到 PageTransition/布局中的隐藏副本。
 */
async function seedAutoInject(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByText("已载入完整演示数据").first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(1500); // PageTransition 动画完成
}

const visibleText = (page: Page, text: string | RegExp) =>
  page.getByText(text as string).filter({ visible: true }).first();

test("全模块演示数据可见性：总览/时间表/任务/课程资料/统计/小组协作", async ({ page }) => {
  await seedAutoInject(page);

  // ---- 总览 ----
  await expect(visibleText(page, /数据结构与算法/)).toBeVisible(); // 本周课表课程块
  await expect(visibleText(page, /进程调度实验报告/)).toBeVisible(); // 临近 DDL（逾期）
  await expect(visibleText(page, /临近 DDL/)).toBeVisible();
  await expect(visibleText(page, /8月/)).toBeVisible(); // MiniCalendar

  // ---- 时间表 ----
  await page.getByRole("button", { name: "时间表" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /贝叶斯公式课后练习/)).toBeVisible(); // StudyBlock 今天 + DDL 点（始终在当前周）
  // 下一周：跨周锚点（+7 天在任何运行日都落在下一周）
  await page.getByRole("button", { name: "下一周" }).click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /大数定律专题精读/)).toBeVisible(); // StudyBlock 下周末
  await expect(page.getByRole("button", { name: /概率论小测验/ })).toBeVisible(); // 考试（以按钮渲染）
  await page.getByRole("button", { name: "上一周" }).click();
  await page.waitForTimeout(600);

  // ---- 任务与 DDL ----
  await page.getByRole("button", { name: "任务与 DDL" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /进程调度实验报告/)).toBeVisible(); // 逾期任务
  await expect(visibleText(page, /整理本周算法笔记/)).toBeVisible(); // 无 DDL 的进行中任务（focus doing 组）
  await expect(visibleText(page, /子任务: 1 \/ 2/)).toBeVisible();
  await expect(visibleText(page, /已计划/)).toBeVisible();

  // ---- 课程资料 + 材料（drawer）----
  await page.getByRole("button", { name: "课程资料" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /人工智能导论/)).toBeVisible(); // 第 10 门课
  await page.getByText("数据结构与算法").first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /第3章 树与二叉树讲义\.pdf/)).toBeVisible();
  await expect(visibleText(page, /算法可视化（Visualgo）/)).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).first().click();
  await page.waitForTimeout(600);

  // ---- 学习洞察：注入的 Focus 历史经 backfill 后呈现完整内容（非空态）----
  await page.getByRole("button", { name: "学习洞察" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /学习趋势/)).toBeVisible();
  await expect(visibleText(page, /专注节奏/)).toBeVisible();
  await expect(visibleText(page, /课程投入/)).toBeVisible();
  await expect(visibleText(page, /学习洞察会随着使用逐渐形成/)).toHaveCount(0); // 不再是空态

  // ---- 小组协作 ----
  await page.getByRole("button", { name: "小组协作" }).first().click();
  await page.waitForTimeout(600);
  await expect(visibleText(page, /校园导航系统课程设计/)).toBeVisible();
  await expect(visibleText(page, /AI Ethics 小组论文/)).toBeVisible();
  await expect(visibleText(page, /企业运营模拟沙盘/)).toBeVisible();
  await expect(visibleText(page, /李晨/)).toBeVisible();
  await expect(visibleText(page, /Dijkstra 算法实现/)).toBeVisible();
});
